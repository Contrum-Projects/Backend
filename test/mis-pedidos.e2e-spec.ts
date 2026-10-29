import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { calcularMontos, precioConIva } from '../src/common/dominio/montos.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import {
  CANALES_VENTA,
  ESTADOS_PEDIDO,
  ORIGENES_DESCRIPCION,
  TIPOS_ARTICULO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
  TIPOS_PRECIO,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/pedidos';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-pedidos';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '93';
const COMUNA = '93001';

interface Resumen {
  codigoPublico: string;
  fechaPedido: string;
  total: number;
  estado: string;
}

interface Historial {
  items: Resumen[];
  total: number;
  pagina: number;
  limite: number;
}

const haceHoras = (horas: number) => new Date(Date.now() - horas * 3_600_000);

describe('Pedidos · historial y detalle de la cuenta (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let porcentajeIva: number;
  let categoriaId: number;
  let comunaId: number;
  const correosCreados: string[] = [];

  const unico = () => randomUUID().slice(0, 8);

  const cuenta = async (rol: Rol) => {
    const email = `e2e-pedidos-${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    const usuario = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Marcela',
        apellido: 'Soto',
        email,
        contrasenaHash: hashContrasena,
        rol,
        fechaVerificacionCorreo: new Date(),
      },
    });
    const respuesta = await request(app.getHttpServer())
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return {
      usuarioId: usuario.id,
      token: (respuesta.body as { tokenAcceso: string }).tokenAcceso,
    };
  };

  const nuevoArticulo = async (tipo: string) => {
    const articulo = await prisma.articuloVenta.create({
      data: {
        sku: `${PREFIJO}-${unico()}`,
        tipo,
        precioMinoristaNeto: 10000,
        precioMayoristaNeto: 8000,
      },
    });
    await prisma.imagenArticulo.create({
      data: {
        articuloId: articulo.id,
        ubicacionArchivo: `articulos/${articulo.id}/principal.jpg`,
        orden: 1,
        esPrincipal: true,
      },
    });
    return articulo.id;
  };

  const nuevoFormato = async () => {
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo ${unico()}`,
        descripcion: 'Repara el cabello.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta: CANALES_VENTA.GENERAL,
        categoriaId,
      },
    });
    const id = await nuevoArticulo(TIPOS_ARTICULO.FORMATO);
    await prisma.formatoProducto.create({
      data: {
        id,
        productoId: producto.id,
        nombreFormato: '300 ml',
        pesoGramos: 320,
        altoCm: 18,
        anchoCm: 6,
        largoCm: 6,
        esPredeterminado: true,
      },
    });
    return { id, nombreProducto: producto.nombre };
  };

  const nuevoPack = async (formatoId: number) => {
    const id = await nuevoArticulo(TIPOS_ARTICULO.PACK);
    const nombre = `${PREFIJO} Dúo ${unico()}`;
    await prisma.pack.create({
      data: {
        id,
        nombre,
        descripcion: 'Shampoo y acondicionador.',
        canalVenta: CANALES_VENTA.GENERAL,
        componentes: { create: [{ formatoId, cantidad: 2 }] },
      },
    });
    return { id, nombre };
  };

  interface LineaNueva {
    articuloId: number;
    cantidad: number;
    neto: number;
    tipoPrecio?: string;
  }

  /** Un pedido de la cuenta, con las líneas y los cambios de estado indicados. */
  const nuevoPedido = async (
    usuarioId: number,
    datos: {
      estado?: string;
      fecha?: Date;
      lineas?: LineaNueva[];
      entrega?: string;
      despacho?: boolean;
      historial?: { estado: string; fechaHora: Date; comentario?: string }[];
    } = {},
  ) => {
    const lineas = datos.lineas ?? [];
    const neto = lineas.reduce(
      (suma, linea) => suma + Math.round(linea.neto) * linea.cantidad,
      0,
    );
    const montos = calcularMontos(neto, porcentajeIva);
    const codigoPublico = randomUUID().replace(/-/g, '').slice(0, 12);
    const estado = datos.estado ?? ESTADOS_PEDIDO.PAGADO;
    const entrega =
      datos.entrega ??
      (datos.despacho ? TIPOS_ENTREGA.DESPACHO : TIPOS_ENTREGA.RETIRO);
    const pedido = await prisma.pedido.create({
      data: {
        codigoPublico,
        usuarioId,
        fechaPedido: datos.fecha ?? new Date(),
        fechaExpiracionPago: new Date(Date.now() + 15 * 60_000),
        estadoActual: estado,
        tipoEntrega: entrega,
        tipoDocumentoSolicitado: TIPOS_DOCUMENTO.BOLETA,
        porcentajeIva,
        montoNeto: montos.neto,
        montoIva: montos.iva,
        montoTotal: montos.total,
        detalles: {
          create: lineas.map((linea) => ({
            articuloId: linea.articuloId,
            cantidad: linea.cantidad,
            precioUnitarioNetoAplicado: linea.neto,
            tipoPrecio: linea.tipoPrecio ?? TIPOS_PRECIO.MINORISTA,
          })),
        },
        historial: {
          create: (datos.historial ?? [{ estado, fechaHora: new Date() }]).map(
            (cambio, indice) => ({
              correlativo: indice + 1,
              ...cambio,
            }),
          ),
        },
        envio: datos.despacho
          ? {
              create: {
                comunaId,
                servicioEnvio: 'Chilexpress',
                costoNeto: 3000,
                estadoEnvio: 'en_transito',
                codigoSeguimiento: 'SEG-123',
                fechaEstimada: new Date('2026-11-05T00:00:00Z'),
                destinatario: 'Marcela Soto',
                telefonoContacto: '+56911112222',
                calle: 'Calle Falsa',
                numero: '123',
                referencia: 'Depto 4',
              },
            }
          : undefined,
      },
    });
    return { codigoPublico: pedido.codigoPublico, total: montos.total };
  };

  const servidor = () => request(app.getHttpServer());

  const limpiar = async () => {
    // Las líneas, los cambios de estado y el envío se borran en cascada con el pedido
    await prisma.pedido.deleteMany({
      where: { usuario: { email: { startsWith: 'e2e-pedidos-' } } },
    });
    await prisma.articuloVenta.deleteMany({
      where: { sku: { startsWith: PREFIJO }, tipo: TIPOS_ARTICULO.PACK },
    });
    await prisma.articuloVenta.deleteMany({
      where: { sku: { startsWith: PREFIJO } },
    });
    await prisma.producto.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.categoria.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    porcentajeIva = app.get(ConfigService).get<number>('IVA_PORCENTAJE')!;
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiar();

    const region = await prisma.region.upsert({
      where: { codigoCut: REGION },
      update: {},
      create: { codigoCut: REGION, nombre: 'Región de prueba pedidos' },
    });
    comunaId = (
      await prisma.comuna.upsert({
        where: { codigoCut: COMUNA },
        update: {},
        create: {
          codigoCut: COMUNA,
          nombre: 'Comuna de prueba pedidos',
          regionId: region.id,
        },
      })
    ).id;
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiar();
    categoriaId = (
      await prisma.categoria.create({
        data: { nombre: `${PREFIJO} Cat ${unico()}` },
      })
    ).id;
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E8-H1 · historial con pedidos: devuelve los de la cuenta con fecha, total y estado actual, del más reciente al más antiguo', async () => {
    const formato = await nuevoFormato();
    const linea = { articuloId: formato.id, cantidad: 1, neto: 10000 };
    const yo = await cuenta(ROLES.CLIENTE);
    const otra = await cuenta(ROLES.CLIENTE);
    const antiguo = await nuevoPedido(yo.usuarioId, {
      fecha: haceHoras(48),
      estado: ESTADOS_PEDIDO.ENTREGADO,
      lineas: [{ ...linea, cantidad: 2 }],
    });
    const reciente = await nuevoPedido(yo.usuarioId, {
      fecha: haceHoras(1),
      estado: ESTADOS_PEDIDO.PENDIENTE_PAGO,
      lineas: [linea],
    });
    await nuevoPedido(otra.usuarioId, { lineas: [linea] });

    const respuesta = await servidor()
      .get(RUTA)
      .auth(yo.token, { type: 'bearer' })
      .expect(200);

    const cuerpo = respuesta.body as Historial;
    expect(cuerpo.total).toBe(2);
    expect(cuerpo.items).toEqual([
      {
        codigoPublico: reciente.codigoPublico,
        fechaPedido: expect.any(String),
        total: reciente.total,
        estado: ESTADOS_PEDIDO.PENDIENTE_PAGO,
      },
      {
        codigoPublico: antiguo.codigoPublico,
        fechaPedido: expect.any(String),
        total: antiguo.total,
        estado: ESTADOS_PEDIDO.ENTREGADO,
      },
    ]);
    expect(new Date(cuerpo.items[0]!.fechaPedido).getTime()).toBeGreaterThan(
      new Date(cuerpo.items[1]!.fechaPedido).getTime(),
    );
  });

  it('E8-H1 · historial: sin pedidos responde vacío y con muchos se pagina', async () => {
    const yo = await cuenta(ROLES.CLIENTE);
    const vacio = await servidor()
      .get(RUTA)
      .auth(yo.token, { type: 'bearer' })
      .expect(200);
    expect(vacio.body).toEqual({ items: [], total: 0, pagina: 1, limite: 20 });

    const codigos: string[] = [];
    for (const horas of [3, 2, 1]) {
      codigos.push(
        (await nuevoPedido(yo.usuarioId, { fecha: haceHoras(horas) }))
          .codigoPublico,
      );
    }
    const segunda = await servidor()
      .get(`${RUTA}?pagina=2&limite=2`)
      .auth(yo.token, { type: 'bearer' })
      .expect(200);
    const cuerpo = segunda.body as Historial;
    expect(cuerpo).toMatchObject({ total: 3, pagina: 2, limite: 2 });
    // El más antiguo queda para la segunda página
    expect(cuerpo.items.map((pedido) => pedido.codigoPublico)).toEqual([
      codigos[0],
    ]);

    await servidor()
      .get(`${RUTA}?limite=0`)
      .auth(yo.token, { type: 'bearer' })
      .expect(400);
  });

  it('E8-H1 · detalle del pedido: devuelve artículos con su precio, montos, forma de entrega y cambios de estado', async () => {
    const formato = await nuevoFormato();
    const pack = await nuevoPack(formato.id);
    const yo = await cuenta(ROLES.CLIENTE);
    const pedido = await nuevoPedido(yo.usuarioId, {
      estado: ESTADOS_PEDIDO.DESPACHADO,
      despacho: true,
      lineas: [
        { articuloId: formato.id, cantidad: 2, neto: 10000.4 },
        { articuloId: pack.id, cantidad: 1, neto: 15000 },
      ],
      historial: [
        {
          estado: ESTADOS_PEDIDO.PAGADO,
          fechaHora: haceHoras(5),
          comentario: 'Pago aprobado',
        },
        {
          estado: ESTADOS_PEDIDO.EN_PREPARACION,
          fechaHora: haceHoras(4),
          comentario: 'Nota interna de bodega',
        },
        { estado: ESTADOS_PEDIDO.DESPACHADO, fechaHora: haceHoras(1) },
      ],
    });

    const respuesta = await servidor()
      .get(`${RUTA}/${pedido.codigoPublico}`)
      .auth(yo.token, { type: 'bearer' })
      .expect(200);

    const unitario = precioConIva(10000.4, porcentajeIva);
    const unitarioPack = precioConIva(15000, porcentajeIva);
    const neto = Math.round(10000.4) * 2 + 15000;
    const montos = calcularMontos(neto, porcentajeIva);
    expect(respuesta.body).toMatchObject({
      codigoPublico: pedido.codigoPublico,
      estado: ESTADOS_PEDIDO.DESPACHADO,
      pagarHasta: null,
      tipoEntrega: TIPOS_ENTREGA.DESPACHO,
      tipoDocumento: TIPOS_DOCUMENTO.BOLETA,
      porcentajeIva,
      montos: { neto: montos.neto, iva: montos.iva, total: montos.total },
      envio: {
        servicio: 'Chilexpress',
        costo: precioConIva(3000, porcentajeIva),
        estado: 'en_transito',
        codigoSeguimiento: 'SEG-123',
        fechaEstimada: '2026-11-05',
        destinatario: 'Marcela Soto',
        telefonoContacto: '+56911112222',
        calle: 'Calle Falsa',
        numero: '123',
        referencia: 'Depto 4',
        comuna: { codigoCut: COMUNA, nombre: 'Comuna de prueba pedidos' },
      },
    });
    const cuerpo = respuesta.body as {
      items: Record<string, unknown>[];
      historial: Record<string, unknown>[];
    };
    expect(cuerpo.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          articuloId: formato.id,
          tipo: TIPOS_ARTICULO.FORMATO,
          nombre: formato.nombreProducto,
          nombreFormato: '300 ml',
          cantidad: 2,
          precioUnitario: unitario,
          subtotal: unitario * 2,
        }),
        expect.objectContaining({
          articuloId: pack.id,
          tipo: TIPOS_ARTICULO.PACK,
          nombre: pack.nombre,
          nombreFormato: null,
          cantidad: 1,
          precioUnitario: unitarioPack,
          subtotal: unitarioPack,
        }),
      ]),
    );
    expect(cuerpo.items).toHaveLength(2);
    expect(cuerpo.items[0]!.imagen).toContain(
      `articulos/${cuerpo.items[0]!.articuloId as number}/principal.jpg`,
    );
    // Cambios de estado en orden, solo con estado y fecha: comentario y autor son del personal
    expect(cuerpo.historial.map((cambio) => cambio.estado)).toEqual([
      ESTADOS_PEDIDO.PAGADO,
      ESTADOS_PEDIDO.EN_PREPARACION,
      ESTADOS_PEDIDO.DESPACHADO,
    ]);
    for (const cambio of cuerpo.historial) {
      expect(Object.keys(cambio).sort()).toEqual(['estado', 'fecha']);
    }
    expect(JSON.stringify(respuesta.body)).not.toContain('Nota interna');

    // El precio cobrado no cambia si el catálogo cambia después
    await prisma.articuloVenta.update({
      where: { id: formato.id },
      data: { precioMinoristaNeto: 99999 },
    });
    const despues = await servidor()
      .get(`${RUTA}/${pedido.codigoPublico}`)
      .auth(yo.token, { type: 'bearer' })
      .expect(200);
    expect(despues.body).toEqual(respuesta.body);
  });

  it('E8-H1 · detalle de un pedido para retiro: sin envío; si espera el pago indica hasta cuándo; el profesional ve lo que pagó', async () => {
    const formato = await nuevoFormato();
    const profesional = await cuenta(ROLES.PROFESIONAL);
    const pedido = await nuevoPedido(profesional.usuarioId, {
      estado: ESTADOS_PEDIDO.PENDIENTE_PAGO,
      lineas: [
        {
          articuloId: formato.id,
          cantidad: 3,
          neto: 8000,
          tipoPrecio: TIPOS_PRECIO.MAYORISTA,
        },
      ],
    });

    const respuesta = await servidor()
      .get(`${RUTA}/${pedido.codigoPublico}`)
      .auth(profesional.token, { type: 'bearer' })
      .expect(200);

    const cuerpo = respuesta.body as {
      pagarHasta: string;
      envio: unknown;
      tipoEntrega: string;
      items: { precioUnitario: number }[];
    };
    expect(cuerpo.envio).toBeNull();
    expect(cuerpo.tipoEntrega).toBe(TIPOS_ENTREGA.RETIRO);
    expect(new Date(cuerpo.pagarHasta).getTime()).toBeGreaterThan(Date.now());
    expect(cuerpo.items[0]!.precioUnitario).toBe(
      precioConIva(8000, porcentajeIva),
    );
  });

  it('E8-H1 · pedido de otra cuenta: responde 404 y no devuelve el pedido', async () => {
    const formato = await nuevoFormato();
    const yo = await cuenta(ROLES.CLIENTE);
    const otra = await cuenta(ROLES.CLIENTE);
    const ajeno = await nuevoPedido(otra.usuarioId, {
      lineas: [{ articuloId: formato.id, cantidad: 1, neto: 10000 }],
    });

    const ajena = await servidor()
      .get(`${RUTA}/${ajeno.codigoPublico}`)
      .auth(yo.token, { type: 'bearer' })
      .expect(404);
    expect(ajena.body).toMatchObject({ message: 'El pedido no existe.' });
    expect(JSON.stringify(ajena.body)).not.toContain('Calle');

    // Un código que no existe o mal formado responde lo mismo
    for (const codigo of ['ZZZZZZZZZZZZ', 'corto', '12345678901234']) {
      const inexistente = await servidor()
        .get(`${RUTA}/${codigo}`)
        .auth(yo.token, { type: 'bearer' })
        .expect(404);
      expect(inexistente.body).toMatchObject({
        message: 'El pedido no existe.',
      });
    }
  });

  it('RNF-03 · sin sesión responde 401 y el personal de tienda 403 en las dos rutas', async () => {
    const personal = await cuenta(ROLES.VENDEDOR);
    for (const ruta of [RUTA, `${RUTA}/ABCDEFGHIJKL`]) {
      await servidor().get(ruta).expect(401);
      await servidor()
        .get(ruta)
        .auth(personal.token, { type: 'bearer' })
        .expect(403);
    }
  });
});
