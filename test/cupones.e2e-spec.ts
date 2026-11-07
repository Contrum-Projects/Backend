import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { precioConIva } from '../src/common/dominio/montos.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import {
  CANALES_VENTA,
  ESTADOS_NOTIFICACION,
  ESTADOS_PEDIDO,
  ORIGENES_DESCRIPCION,
  TIPOS_ARTICULO,
  TIPOS_CAMPANA,
  TIPOS_NOTIFICACION,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/marketing/cupones';
const PREFIJO = 'E2E-cupones';
const PREFIJO_CORREO = 'e2e-cupones-';
const PREFIJO_CODIGO = 'E2ECUP';
const IVA = 19;

interface Cupon {
  id: number;
  codigo: string;
  usos: number;
  descontado: number;
  articulos: { id: number; nombre: string }[];
  marcas: { id: number; nombre: string }[];
}

interface Pedido {
  codigoPublico: string;
  montos: { neto: number; iva: number; total: number; descuento: number };
  cupon: string | null;
}

describe('Cupones (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let tokenAdministrador: string;
  let administradorId: number;
  let categoriaId: number;
  let ubicacionId: number;
  let marcaId: number;

  const unico = () => randomUUID().slice(0, 8).toUpperCase();
  const servidor = () => request(app.getHttpServer());
  const codigo = () => `${PREFIJO_CODIGO}-${unico()}`;

  const cuenta = async (rol: Rol) => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
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
    const respuesta = await servidor()
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return {
      id: usuario.id,
      token: (respuesta.body as { tokenAcceso: string }).tokenAcceso,
    };
  };

  /** Formato con stock, de la marca de prueba si `conMarca`. */
  const nuevoFormato = async (neto: number, conMarca = true) => {
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo ${unico()}`,
        descripcion: 'Repara el cabello.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta: CANALES_VENTA.GENERAL,
        categoriaId,
        marcaId: conMarca ? marcaId : null,
      },
    });
    const articulo = await prisma.articuloVenta.create({
      data: {
        sku: `${PREFIJO}-${unico()}`,
        tipo: TIPOS_ARTICULO.FORMATO,
        precioMinoristaNeto: neto,
        precioMayoristaNeto: Math.round(neto * 0.8),
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
    await prisma.formatoProducto.create({
      data: {
        id: articulo.id,
        productoId: producto.id,
        nombreFormato: '300 ml',
        pesoGramos: 320,
        altoCm: 18,
        anchoCm: 6,
        largoCm: 6,
        esPredeterminado: true,
      },
    });
    await prisma.existencia.create({
      data: { formatoId: articulo.id, ubicacionId, cantidad: 50 },
    });
    return articulo.id;
  };

  const llenarCarrito = (
    usuarioId: number,
    items: { articuloId: number; cantidad: number }[],
  ) =>
    prisma.carrito.upsert({
      where: { usuarioId },
      create: { usuarioId, items: { create: items } },
      update: { items: { deleteMany: {}, create: items } },
    });

  const crearCupon = (cuerpo: object, token = tokenAdministrador) =>
    servidor()
      .post(RUTA)
      .auth(token, { type: 'bearer' })
      .send({
        codigo: codigo(),
        tipoDescuento: 'porcentaje',
        valor: 20,
        alcance: 'pedido',
        ...cuerpo,
      });

  const validar = (token: string, codigoCupon: string) =>
    servidor()
      .post('/api/carrito/cupon')
      .auth(token, { type: 'bearer' })
      .send({ codigo: codigoCupon });

  const confirmar = (token: string, codigoCupon?: string) =>
    servidor()
      .post('/api/pedidos')
      .auth(token, { type: 'bearer' })
      .send({
        claveIdempotencia: randomUUID(),
        tipoEntrega: 'retiro',
        tipoDocumento: 'boleta',
        ...(codigoCupon && { codigoCupon }),
      });

  const mensaje = (cuerpo: unknown) => JSON.stringify(cuerpo);

  const limpiarLimites = async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
  };

  const limpiar = async () => {
    const correo = { startsWith: PREFIJO_CORREO };
    await prisma.movimientoInventario.deleteMany({
      where: { formato: { articulo: { sku: { startsWith: PREFIJO } } } },
    });
    await prisma.existencia.deleteMany({
      where: { formato: { articulo: { sku: { startsWith: PREFIJO } } } },
    });
    await prisma.pedido.deleteMany({ where: { usuario: { email: correo } } });
    await prisma.cupon.deleteMany({
      where: { codigo: { startsWith: PREFIJO_CODIGO } },
    });
    await prisma.notificacion.deleteMany({
      where: { usuario: { email: correo } },
    });
    await prisma.campana.deleteMany({
      where: { asunto: { startsWith: PREFIJO } },
    });
    await prisma.itemCarrito.deleteMany({
      where: { articulo: { sku: { startsWith: PREFIJO } } },
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
    await prisma.marca.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.ubicacion.deleteMany({
      where: { bodega: { nombre: { startsWith: PREFIJO } } },
    });
    await prisma.bodega.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.usuario.deleteMany({ where: { email: correo } });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiar();

    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    tokenAdministrador = administrador.token;
    administradorId = administrador.id;
    const comuna = await prisma.comuna.findFirstOrThrow();
    const bodega = await prisma.bodega.create({
      data: {
        nombre: `${PREFIJO} Central`,
        direccion: 'Calle de prueba 300',
        tipo: 'tienda',
        comunaId: comuna.id,
        abasteceVentaOnline: true,
      },
    });
    ubicacionId = (
      await prisma.ubicacion.create({
        data: { bodegaId: bodega.id, codigo: 'GONDOLA-1' },
      })
    ).id;
    categoriaId = (
      await prisma.categoria.create({
        data: { nombre: `${PREFIJO} Cat ${unico()}` },
      })
    ).id;
    marcaId = (
      await prisma.marca.create({
        data: { nombre: `${PREFIJO} Marca ${unico()}` },
      })
    ).id;
  });

  beforeEach(limpiarLimites);

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  it('SCRUM-150 · panel: crea un cupón por marca y lo lista con sus usos; el código se guarda en mayúsculas y no se repite', async () => {
    const creado = await crearCupon({
      codigo: `${PREFIJO_CODIGO}-marca-x`,
      alcance: 'categorias_marcas',
      marcas: [marcaId],
    }).expect(201);
    expect(creado.body as Cupon).toMatchObject({
      codigo: `${PREFIJO_CODIGO}-MARCA-X`,
      usos: 0,
      descontado: 0,
      marcas: [{ id: marcaId }],
    });

    const lista = await servidor()
      .get(RUTA)
      .auth(tokenAdministrador, { type: 'bearer' })
      .expect(200);
    expect(
      (lista.body as Cupon[]).some((c) => c.id === (creado.body as Cupon).id),
    ).toBe(true);

    const repetido = await crearCupon({
      codigo: `${PREFIJO_CODIGO}-MARCA-X`,
    }).expect(409);
    expect(mensaje(repetido.body)).toContain('Ya existe un cupón');
  });

  it('SCRUM-150 · panel: reglas que no calzan responden 400 junto al campo, y sin permiso 403', async () => {
    expect(
      mensaje((await crearCupon({ valor: 120 }).expect(400)).body),
    ).toContain('de 1 a 100');
    expect(
      mensaje(
        (
          await crearCupon({
            tipoDescuento: 'monto_fijo',
            valor: 5000,
            topeDescuento: 100,
          }).expect(400)
        ).body,
      ),
    ).toContain('El tope solo');
    expect(
      mensaje((await crearCupon({ alcance: 'articulos' }).expect(400)).body),
    ).toContain('Elige al menos un formato o pack');
    expect(
      mensaje(
        (
          await crearCupon({
            fechaInicio: '2026-12-10T00:00:00.000Z',
            fechaFin: '2026-12-01T00:00:00.000Z',
          }).expect(400)
        ).body,
      ),
    ).toContain('posterior al inicio');
    await crearCupon({ codigo: 'con espacio' }).expect(400);

    const vendedor = await cuenta(ROLES.VENDEDOR);
    await crearCupon({}, vendedor.token).expect(403);
  });

  it('SCRUM-150 · comprador: el cupón descuenta en la vista previa y en el pedido, que guarda montos y código; un uso por cuenta y cancelar lo libera', async () => {
    const neto = 1003;
    const formato = await nuevoFormato(neto);
    const comprador = await cuenta(ROLES.CLIENTE);
    await llenarCarrito(comprador.id, [{ articuloId: formato, cantidad: 3 }]);
    const { body: cupon } = (await crearCupon({
      alcance: 'categorias_marcas',
      marcas: [marcaId],
      usosPorCuenta: 1,
      descripcion: '20 % en la marca',
    }).expect(201)) as { body: Cupon };

    const subtotal = precioConIva(neto, IVA) * 3;
    const descuento = Math.round(subtotal * 0.2);
    const vista = await validar(
      comprador.token,
      cupon.codigo.toLowerCase(),
    ).expect(200);
    expect(vista.body).toEqual({
      codigo: cupon.codigo,
      descripcion: '20 % en la marca',
      descuento,
      totalProductos: subtotal - descuento,
    });

    const respuesta = await confirmar(comprador.token, cupon.codigo).expect(
      201,
    );
    const pedido = respuesta.body as Pedido;
    expect(pedido.cupon).toBe(cupon.codigo);
    expect(pedido.montos.descuento).toBe(descuento);
    expect(pedido.montos.total).toBe(subtotal - descuento);
    expect(pedido.montos.neto + pedido.montos.iva).toBe(pedido.montos.total);

    const detalle = await servidor()
      .get(`${RUTA}/${cupon.id}`)
      .auth(tokenAdministrador, { type: 'bearer' })
      .expect(200);
    expect(detalle.body).toMatchObject({ usos: 1, descontado: descuento });

    await llenarCarrito(comprador.id, [{ articuloId: formato, cantidad: 1 }]);
    await prisma.pedido.updateMany({
      where: { codigoPublico: pedido.codigoPublico },
      data: { estadoActual: ESTADOS_PEDIDO.PAGADO },
    });
    expect(
      mensaje((await validar(comprador.token, cupon.codigo).expect(400)).body),
    ).toContain('Ya usaste este cupón');

    // Un pedido cancelado no cuenta como uso
    await prisma.pedido.updateMany({
      where: { codigoPublico: pedido.codigoPublico },
      data: { estadoActual: ESTADOS_PEDIDO.CANCELADO },
    });
    await validar(comprador.token, cupon.codigo).expect(200);
  });

  it('SCRUM-150 · comprador: un código mal escrito, vencido, sin compra mínima o que no cubre el carrito no aplica y el pedido no se crea', async () => {
    const sinMarca = await nuevoFormato(1000, false);
    const comprador = await cuenta(ROLES.CLIENTE);
    await llenarCarrito(comprador.id, [{ articuloId: sinMarca, cantidad: 1 }]);

    expect(
      mensaje(
        (await validar(comprador.token, 'NO-EXISTE-123').expect(400)).body,
      ),
    ).toContain('no existe o ya no está disponible');

    const porMarca = (
      await crearCupon({
        alcance: 'categorias_marcas',
        marcas: [marcaId],
      }).expect(201)
    ).body as Cupon;
    expect(
      mensaje(
        (await validar(comprador.token, porMarca.codigo).expect(400)).body,
      ),
    ).toContain('no aplica a los productos');
    await confirmar(comprador.token, porMarca.codigo).expect(400);
    expect(
      await prisma.pedido.count({ where: { usuarioId: comprador.id } }),
    ).toBe(0);

    const vencido = (
      await crearCupon({
        fechaInicio: '2026-01-01T00:00:00.000Z',
        fechaFin: '2026-02-01T00:00:00.000Z',
      }).expect(201)
    ).body as Cupon;
    expect(
      mensaje(
        (await validar(comprador.token, vencido.codigo).expect(400)).body,
      ),
    ).toContain('venció');

    const conMinimo = (await crearCupon({ compraMinima: 50000 }).expect(201))
      .body as Cupon;
    expect(
      mensaje(
        (await validar(comprador.token, conMinimo.codigo).expect(400)).body,
      ),
    ).toContain('compras desde $50.000');

    const inactivo = (await crearCupon({ activo: false }).expect(201))
      .body as Cupon;
    await validar(comprador.token, inactivo.codigo).expect(400);
  });

  it('SCRUM-150 · de campaña: solo lo usan las cuentas a las que se les envió; al profesional, solo si lo permite', async () => {
    const formato = await nuevoFormato(2000);
    const campana = await prisma.campana.create({
      data: {
        usuarioId: administradorId,
        tipo: TIPOS_CAMPANA.ENVIO_UNICO,
        asunto: `${PREFIJO} Novedades`,
        cuerpo: 'Hola',
        fechaEncolado: new Date(),
      },
    });
    const cupon = (await crearCupon({ campanaId: campana.id }).expect(201))
      .body as Cupon;

    const destinatario = await cuenta(ROLES.CLIENTE);
    const otro = await cuenta(ROLES.CLIENTE);
    for (const { id } of [destinatario, otro]) {
      await llenarCarrito(id, [{ articuloId: formato, cantidad: 1 }]);
    }
    await prisma.notificacion.create({
      data: {
        usuarioId: destinatario.id,
        campanaId: campana.id,
        tipo: TIPOS_NOTIFICACION.CAMPANA,
        asunto: 'Novedades',
        estadoEnvio: ESTADOS_NOTIFICACION.ENVIADA,
      },
    });

    await validar(destinatario.token, cupon.codigo).expect(200);
    expect(
      mensaje((await validar(otro.token, cupon.codigo).expect(400)).body),
    ).toContain('no existe o ya no está disponible');

    const profesional = await cuenta(ROLES.PROFESIONAL);
    await llenarCarrito(profesional.id, [{ articuloId: formato, cantidad: 1 }]);
    const soloMinorista = (await crearCupon({}).expect(201)).body as Cupon;
    expect(
      mensaje(
        (await validar(profesional.token, soloMinorista.codigo).expect(400))
          .body,
      ),
    ).toContain('precio profesional');
    const paraTodos = (
      await crearCupon({ incluyeProfesionales: true }).expect(201)
    ).body as Cupon;
    const vista = await validar(profesional.token, paraTodos.codigo).expect(
      200,
    );
    // Sobre el mayorista (80 % del neto en esta prueba)
    expect((vista.body as { descuento: number }).descuento).toBe(
      Math.round(precioConIva(1600, IVA) * 0.2),
    );
  });

  it('SCRUM-150 · usos máximos: dos pedidos simultáneos con el último uso, solo uno lo obtiene', async () => {
    const formato = await nuevoFormato(1500);
    const cupon = (await crearCupon({ usosMaximos: 1 }).expect(201))
      .body as Cupon;
    const [a, b] = await Promise.all([
      cuenta(ROLES.CLIENTE),
      cuenta(ROLES.CLIENTE),
    ]);
    await llenarCarrito(a.id, [{ articuloId: formato, cantidad: 1 }]);
    await llenarCarrito(b.id, [{ articuloId: formato, cantidad: 1 }]);

    const respuestas = await Promise.all([
      confirmar(a.token, cupon.codigo),
      confirmar(b.token, cupon.codigo),
    ]);
    expect(respuestas.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await prisma.pedido.count({ where: { cuponId: cupon.id } })).toBe(1);
  });
});
