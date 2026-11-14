import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import {
  CANALES_VENTA,
  ESTADOS_ENVIO,
  ESTADOS_PEDIDO,
  ORIGENES_DESCRIPCION,
  TIPOS_ARTICULO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import {
  CreadorOrdenTransporte,
  ErrorCreacionOt,
  type SolicitudOt,
} from '../src/modulos/despacho/orden-transporte.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const PREFIJO = 'E2E-ot';
const PREFIJO_CORREO = 'e2e-ot-';
/** Santiago (STGO) y Providencia (PROV) en `CODIGOS_CHILEXPRESS`. */
const COMUNA_BODEGA = '13101';
const COMUNA_DESTINO = '13123';
const REGION_METROPOLITANA = '13';
/** Una etiqueta PDF mínima, en base64, como la entrega Chilexpress. */
const ETIQUETA = Buffer.from('%PDF-1.4 etiqueta de prueba').toString('base64');

/** Chilexpress de mentira: guarda cada solicitud y responde la OT que se le pida. */
class CreadorDePrueba extends CreadorOrdenTransporte {
  readonly configurado = true;
  solicitudes: SolicitudOt[] = [];
  falla = false;

  crear(solicitud: SolicitudOt) {
    this.solicitudes.push(solicitud);
    if (this.falla) {
      return Promise.reject(new ErrorCreacionOt('Chilexpress no respondió.'));
    }
    return Promise.resolve({
      numero: `7121${String(Date.now()).slice(-8)}`,
      etiqueta: ETIQUETA,
    });
  }
}

describe('Despacho · crear la OT al despachar (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let creador: CreadorDePrueba;
  let bodeguero: string;
  let administrador: string;
  let compradorId: number;
  let formatoId: number;
  let bodegaDespachoAnterior: number | null = null;
  /** Lo que la prueba creó porque la base no traía la semilla; se borra al terminar. */
  const territorioCreado = { region: false, comunas: [] as string[] };

  const unico = () => randomUUID().slice(0, 8);

  /**
   * El CI corre los e2e sin la semilla de comunas (SCRUM-161). Estas deben ser las reales:
   * Chilexpress las reconoce por su código CUT (`CODIGOS_CHILEXPRESS`).
   */
  const asegurarTerritorio = async () => {
    let region = await prisma.region.findUnique({
      where: { codigoCut: REGION_METROPOLITANA },
    });
    if (!region) {
      region = await prisma.region.create({
        data: {
          codigoCut: REGION_METROPOLITANA,
          nombre: 'Metropolitana de Santiago',
        },
      });
      territorioCreado.region = true;
    }
    for (const [codigoCut, nombre] of [
      [COMUNA_BODEGA, 'Santiago'],
      [COMUNA_DESTINO, 'Providencia'],
    ]) {
      if (await prisma.comuna.findUnique({ where: { codigoCut } })) continue;
      await prisma.comuna.create({
        data: { codigoCut, nombre, regionId: region.id },
      });
      territorioCreado.comunas.push(codigoCut);
    }
  };
  const servidor = () => request(app.getHttpServer());

  const tokenDe = async (rol: Rol) => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Rosa',
        apellido: 'Pérez',
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
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  /** Un pedido con despacho en preparación, con su servicio cotizado y 2 unidades. */
  const nuevoPedido = async (
    cambios: { codigoServicio?: number | null } = {},
  ) => {
    const codigoPublico = randomUUID()
      .replaceAll('-', '')
      .slice(0, 12)
      .toUpperCase();
    const comuna = await prisma.comuna.findUniqueOrThrow({
      where: { codigoCut: COMUNA_DESTINO },
    });
    await prisma.pedido.create({
      data: {
        codigoPublico,
        usuarioId: compradorId,
        fechaExpiracionPago: new Date(Date.now() + 15 * 60_000),
        estadoActual: ESTADOS_PEDIDO.EN_PREPARACION,
        tipoEntrega: TIPOS_ENTREGA.DESPACHO,
        tipoDocumentoSolicitado: TIPOS_DOCUMENTO.BOLETA,
        porcentajeIva: 19,
        montoNeto: 23109,
        montoIva: 4391,
        montoTotal: 27500,
        historial: {
          create: [{ correlativo: 1, estado: ESTADOS_PEDIDO.EN_PREPARACION }],
        },
        detalles: {
          create: [
            {
              articuloId: formatoId,
              cantidad: 2,
              precioUnitarioNetoAplicado: 10000,
              tipoPrecio: 'minorista',
            },
          ],
        },
        envio: {
          create: {
            comunaId: comuna.id,
            servicioEnvio: 'EXPRESS',
            codigoServicio:
              cambios.codigoServicio === undefined ? 3 : cambios.codigoServicio,
            costoNeto: 3000,
            estadoEnvio: ESTADOS_ENVIO.PENDIENTE,
            destinatario: 'Camila Rojas',
            telefonoContacto: '+56912345678',
            calle: 'Avenida Manuel Montt',
            numero: '427',
            referencia: 'Depto. 301',
          },
        },
      },
    });
    return codigoPublico;
  };

  const despachar = (codigo: string, cuerpo: object = {}) =>
    servidor()
      .post(`/api/pedidos/${codigo}/estado`)
      .auth(bodeguero, { type: 'bearer' })
      .send({ estado: 'despachado', ...cuerpo });

  const envioDe = (codigo: string) =>
    prisma.envio.findFirstOrThrow({
      where: { pedido: { codigoPublico: codigo } },
    });

  const mensaje = (cuerpo: unknown) => JSON.stringify(cuerpo);

  const limpiar = async () => {
    const correo = { startsWith: PREFIJO_CORREO };
    await prisma.notificacion.deleteMany({
      where: { usuario: { email: correo } },
    });
    await prisma.pedido.deleteMany({ where: { usuario: { email: correo } } });
    await prisma.articuloVenta.deleteMany({
      where: { sku: { startsWith: PREFIJO } },
    });
    await prisma.producto.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.categoria.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.bodega.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.usuario.deleteMany({ where: { email: correo } });
  };

  beforeAll(async () => {
    creador = new CreadorDePrueba();
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CreadorOrdenTransporte)
      .useValue(creador)
      .compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiar();
    await asegurarTerritorio();
    // La base de desarrollo puede tener su bodega de despacho: se devuelve al terminar
    bodegaDespachoAnterior =
      (await prisma.bodega.findFirst({ where: { esDespacho: true } }))?.id ??
      null;

    bodeguero = await tokenDe(ROLES.BODEGUERO);
    administrador = await tokenDe(ROLES.ADMINISTRADOR);
    compradorId = (
      await prisma.usuario.create({
        data: {
          codigoPublico: randomUUID(),
          nombre: 'Camila',
          apellido: 'Rojas',
          email: `${PREFIJO_CORREO}comprador-${randomUUID()}@prueba.cl`,
          contrasenaHash: 'sin-uso',
          rol: ROLES.CLIENTE,
          fechaVerificacionCorreo: new Date(),
        },
      })
    ).id;
    const categoria = await prisma.categoria.create({
      data: { nombre: `${PREFIJO} Cat ${unico()}` },
    });
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo ${unico()}`,
        descripcion: 'Repara.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta: CANALES_VENTA.GENERAL,
        categoriaId: categoria.id,
      },
    });
    formatoId = (
      await prisma.articuloVenta.create({
        data: { sku: `${PREFIJO}-${unico()}`, tipo: TIPOS_ARTICULO.FORMATO },
      })
    ).id;
    await prisma.formatoProducto.create({
      data: {
        id: formatoId,
        productoId: producto.id,
        nombreFormato: '300 ml',
        pesoGramos: 320,
        altoCm: 18,
        anchoCm: 6,
        largoCm: 6,
        esPredeterminado: true,
      },
    });
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    creador.solicitudes = [];
    creador.falla = false;
  });

  afterAll(async () => {
    await limpiar();
    if (bodegaDespachoAnterior !== null) {
      await prisma.bodega.update({
        where: { id: bodegaDespachoAnterior },
        data: { esDespacho: true },
      });
    }
    await prisma.comuna.deleteMany({
      where: { codigoCut: { in: territorioCreado.comunas } },
    });
    if (territorioCreado.region) {
      await prisma.region.deleteMany({
        where: { codigoCut: REGION_METROPOLITANA },
      });
    }
    await app.close();
  });

  it('SCRUM-153 · CA1 bodega de despacho: solo una, y debe estar activa', async () => {
    const crear = async () =>
      (
        await servidor()
          .post('/api/inventario/bodegas')
          .auth(administrador, { type: 'bearer' })
          .send({
            nombre: `${PREFIJO} ${unico()}`,
            direccion: 'Av. Matta 1234',
            comuna: COMUNA_BODEGA,
            tipo: 'bodega',
          })
          .expect(201)
      ).body as { id: number };
    const marcar = (id: number, cuerpo: object) =>
      servidor()
        .patch(`/api/inventario/bodegas/${id}`)
        .auth(administrador, { type: 'bearer' })
        .send(cuerpo);

    const a = await crear();
    const b = await crear();
    await marcar(a.id, { esDespacho: true }).expect(200);
    await marcar(b.id, { esDespacho: true }).expect(200);
    const despacho = await prisma.bodega.findMany({
      where: { esDespacho: true },
    });
    expect(despacho.map((d) => d.id)).toEqual([b.id]);

    // Desactivada deja de ser la de despacho; una inactiva no se puede marcar
    await marcar(b.id, { activa: false }).expect(200);
    expect(await prisma.bodega.count({ where: { esDespacho: true } })).toBe(0);
    expect(
      mensaje((await marcar(b.id, { esDespacho: true }).expect(400)).body),
    ).toContain('debe estar activa');
    await marcar(a.id, { esDespacho: true }).expect(200);
  });

  it('SCRUM-153 · CA2 despachar sin número crea la OT con los datos del pedido y guarda número y etiqueta', async () => {
    const codigo = await nuevoPedido();

    const detalle = await servidor()
      .get(`/api/gestion/pedidos/${codigo}`)
      .auth(bodeguero, { type: 'bearer' })
      .expect(200);
    expect(
      (
        detalle.body as {
          cambiosPermitidos: { estado: string; creaOt: boolean }[];
        }
      ).cambiosPermitidos,
    ).toContainEqual(
      expect.objectContaining({ estado: 'despachado', creaOt: true }),
    );

    await despachar(codigo).expect(200);

    expect(creador.solicitudes).toHaveLength(1);
    expect(creador.solicitudes[0]).toMatchObject({
      origen: 'STGO',
      destino: {
        cobertura: 'PROV',
        calle: 'Avenida Manuel Montt',
        numero: '427',
        complemento: 'Depto. 301',
      },
      devolucion: { cobertura: 'STGO', calle: 'Av. Matta 1234' },
      destinatario: { nombre: 'Camila Rojas', telefono: '+56912345678' },
      // Dos unidades de 320 g: un cubo con el volumen de las dos
      bulto: { pesoGramos: 640 },
      codigoServicio: 3,
      referencia: codigo,
      // El total sin el despacho con IVA (3.000 neto → 3.570)
      valorDeclarado: 27500 - 3570,
    });
    const envio = await envioDe(codigo);
    expect(envio.codigoSeguimiento).toMatch(/^7121\d{8}$/);
    expect(envio.etiqueta).toBe(ETIQUETA);
    expect(envio.estadoEnvio).toBe(ESTADOS_ENVIO.EN_TRANSITO);

    // CA4: la etiqueta se descarga desde el panel
    const etiqueta = await servidor()
      .get(`/api/gestion/pedidos/${codigo}/etiqueta`)
      .auth(bodeguero, { type: 'bearer' })
      .buffer(true)
      .parse((res, fin) => {
        const partes: Buffer[] = [];
        res.on('data', (parte: Buffer) => partes.push(parte));
        res.on('end', () => fin(null, Buffer.concat(partes)));
      })
      .expect(200);
    expect(etiqueta.headers['content-type']).toContain('application/pdf');
    expect((etiqueta.body as Buffer).toString()).toContain('%PDF-1.4');
  });

  it('SCRUM-153 · CA3 si Chilexpress falla, el pedido no cambia y el mensaje ofrece escribir el número', async () => {
    const codigo = await nuevoPedido();
    creador.falla = true;

    const respuesta = await despachar(codigo).expect(503);
    expect(mensaje(respuesta.body)).toContain('escribir su número');
    const pedido = await prisma.pedido.findUniqueOrThrow({
      where: { codigoPublico: codigo },
    });
    expect(pedido.estadoActual).toBe(ESTADOS_PEDIDO.EN_PREPARACION);
    expect((await envioDe(codigo)).codigoSeguimiento).toBeNull();

    // Respaldo: con el número escrito a mano despacha sin llamar a Chilexpress
    creador.solicitudes = [];
    await despachar(codigo, { codigoSeguimiento: '99887766' }).expect(200);
    expect(creador.solicitudes).toHaveLength(0);
    expect(await envioDe(codigo)).toMatchObject({
      codigoSeguimiento: '99887766',
      etiqueta: null,
    });
    await servidor()
      .get(`/api/gestion/pedidos/${codigo}/etiqueta`)
      .auth(bodeguero, { type: 'bearer' })
      .expect(404);
  });

  it('SCRUM-153 · CA3 un pedido sin el servicio cotizado no llama a Chilexpress y explica por qué', async () => {
    const codigo = await nuevoPedido({ codigoServicio: null });

    const respuesta = await despachar(codigo).expect(409);
    expect(mensaje(respuesta.body)).toContain('servicio de Chilexpress');
    expect(creador.solicitudes).toHaveLength(0);
  });
});
