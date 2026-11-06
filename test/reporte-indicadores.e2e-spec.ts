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
  ESTADOS_PEDIDO,
  ESTADOS_SOLICITUD,
  ORIGENES_DESCRIPCION,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/reportes/indicadores';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-reporte-indicadores';
const PREFIJO_CORREO = 'e2e-reporte-indicadores-';
const HORA_MS = 3_600_000;

interface Indicador {
  codigo: string;
  meta: number;
  porcentaje: number | null;
  cumplidos: number;
  total: number;
  sinDatos: boolean;
}

interface Reporte {
  desde: string;
  hasta: string;
  indicadores: Indicador[];
}

/**
 * Los datos de estas pruebas van en junio de 2021, un mes ya pasado en que no hay otros registros
 * en la base: así los conteos son exactos y toda solicitud sin resolver lleva más de 48 h. En
 * junio Chile está en UTC-4.
 */
const DESDE = '2021-06-01';
const HASTA = '2021-06-30';

describe('Reportes · indicadores de los objetivos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let tokenAdministrador: string;
  let categoriaId: number;

  const servidor = () => request(app.getHttpServer());

  const nuevaCuenta = async (rol: Rol) => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    const usuario = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Camila',
        apellido: 'Rojas',
        email,
        contrasenaHash: hashContrasena,
        rol,
        fechaVerificacionCorreo: new Date(),
      },
    });
    return { id: usuario.id, email };
  };

  const tokenDe = async (rol: Rol) => {
    const { email } = await nuevaCuenta(rol);
    const respuesta = await servidor()
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  const nuevaSolicitud = async (datos: {
    estado: string;
    presentada: string;
    horasHastaResolver?: number;
  }) => {
    const { id } = await nuevaCuenta(ROLES.CLIENTE);
    const presentada = new Date(datos.presentada);
    await prisma.solicitudVerificacion.create({
      data: {
        solicitanteId: id,
        estado: datos.estado,
        fechaSolicitud: presentada,
        fechaResolucion:
          datos.horasHastaResolver === undefined
            ? null
            : new Date(
                presentada.getTime() + datos.horasHastaResolver * HORA_MS,
              ),
      },
    });
    return id;
  };

  const nuevoPedido = (usuarioId: number, fecha: string, estado: string) =>
    prisma.pedido.create({
      data: {
        codigoPublico: randomUUID().replace(/-/g, '').slice(0, 12),
        usuarioId,
        fechaPedido: new Date(fecha),
        fechaExpiracionPago: new Date(new Date(fecha).getTime() + 15 * 60_000),
        estadoActual: estado,
        tipoEntrega: TIPOS_ENTREGA.RETIRO,
        tipoDocumentoSolicitado: TIPOS_DOCUMENTO.BOLETA,
        porcentajeIva: 19,
        montoNeto: 10000,
        montoIva: 1900,
        montoTotal: 11900,
      },
    });

  const nuevoProducto = (origenDescripcion: string, fecha: string) =>
    prisma.producto.create({
      data: {
        categoriaId,
        nombre: `${PREFIJO} ${randomUUID().slice(0, 8)}`,
        descripcion: 'Descripción de prueba',
        origenDescripcion,
        canalVenta: CANALES_VENTA.GENERAL,
        fechaCreacion: new Date(fecha),
      },
    });

  const consultar = (
    desde = DESDE,
    hasta = HASTA,
    token = tokenAdministrador,
  ) =>
    servidor()
      .get(RUTA)
      .query({ desde, hasta })
      .auth(token, { type: 'bearer' });

  const indicador = (reporte: Reporte, codigo: string) =>
    reporte.indicadores.find((i) => i.codigo === codigo)!;

  const limpiarDatos = async () => {
    const usuario = { email: { startsWith: PREFIJO_CORREO } };
    await prisma.pedido.deleteMany({ where: { usuario } });
    await prisma.solicitudVerificacion.deleteMany({
      where: { solicitante: usuario },
    });
    await prisma.producto.deleteMany({
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
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiarDatos();
    tokenAdministrador = await tokenDe(ROLES.ADMINISTRADOR);
    categoriaId = (await prisma.categoria.create({ data: { nombre: PREFIJO } }))
      .id;
  });

  // Todas las peticiones salen de la misma IP: cada prueba parte sin contadores ni datos
  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiarDatos();
  });

  afterAll(async () => {
    await limpiarDatos();
    await prisma.categoria.deleteMany({ where: { nombre: PREFIJO } });
    await prisma.sesion.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: PREFIJO_CORREO } },
    });
    await app.close();
  });

  it('E14-H1 · CA1 indicadores con datos: devuelve cada indicador como porcentaje junto a su meta', async () => {
    // OE1: dos verificados en junio; uno compró después de aprobarse y otro solo antes
    const compra = await nuevaSolicitud({
      estado: ESTADOS_SOLICITUD.APROBADA,
      presentada: '2021-06-05T12:00:00Z',
      horasHastaResolver: 0,
    });
    await nuevoPedido(compra, '2021-06-20T12:00:00Z', ESTADOS_PEDIDO.ENTREGADO);
    const soloAntes = await nuevaSolicitud({
      estado: ESTADOS_SOLICITUD.APROBADA,
      presentada: '2021-06-10T12:00:00Z',
      horasHastaResolver: 0,
    });
    await nuevoPedido(soloAntes, '2021-06-09T12:00:00Z', ESTADOS_PEDIDO.PAGADO);
    // OE3: 3 de 4 productos con la IA (aceptada o corregida)
    await nuevoProducto(ORIGENES_DESCRIPCION.IA, '2021-06-02T12:00:00Z');
    await nuevoProducto(
      ORIGENES_DESCRIPCION.IA_EDITADA,
      '2021-06-03T12:00:00Z',
    );
    await nuevoProducto(ORIGENES_DESCRIPCION.IA, '2021-06-04T12:00:00Z');
    await nuevoProducto(ORIGENES_DESCRIPCION.MANUAL, '2021-06-05T12:00:00Z');

    const respuesta = await consultar().expect(200);

    const reporte = respuesta.body as Reporte;
    expect(reporte.desde).toBe(DESDE);
    expect(reporte.hasta).toBe(HASTA);
    expect(indicador(reporte, 'OE1')).toMatchObject({
      meta: 30,
      cumplidos: 1,
      total: 2,
      porcentaje: 50,
      sinDatos: false,
    });
    // Las dos aprobadas por el SII al instante: ambas dentro de las 48 h
    expect(indicador(reporte, 'OE2')).toMatchObject({
      meta: 70,
      cumplidos: 2,
      total: 2,
      porcentaje: 100,
    });
    expect(indicador(reporte, 'OE3')).toMatchObject({
      meta: 80,
      cumplidos: 3,
      total: 4,
      porcentaje: 75,
    });
  });

  it('E14-H1 · OE1: una compra posterior al fin del período no cuenta, y la del mismo instante de la aprobación sí', async () => {
    const despues = await nuevaSolicitud({
      estado: ESTADOS_SOLICITUD.APROBADA,
      presentada: '2021-06-05T12:00:00Z',
      horasHastaResolver: 0,
    });
    await nuevoPedido(despues, '2021-07-02T12:00:00Z', ESTADOS_PEDIDO.PAGADO);
    const mismoInstante = await nuevaSolicitud({
      estado: ESTADOS_SOLICITUD.APROBADA,
      presentada: '2021-06-06T12:00:00Z',
      horasHastaResolver: 0,
    });
    await nuevoPedido(
      mismoInstante,
      '2021-06-06T12:00:00Z',
      ESTADOS_PEDIDO.PAGADO,
    );

    const reporte = (await consultar().expect(200)).body as Reporte;

    expect(indicador(reporte, 'OE1')).toMatchObject({
      cumplidos: 1,
      total: 2,
    });
  });

  it('E14-H1 · OE1: una cuenta con dos aprobaciones en el período cuenta una sola vez', async () => {
    const cuenta = await nuevaSolicitud({
      estado: ESTADOS_SOLICITUD.APROBADA,
      presentada: '2021-06-05T12:00:00Z',
      horasHastaResolver: 0,
    });
    await prisma.solicitudVerificacion.create({
      data: {
        solicitanteId: cuenta,
        estado: ESTADOS_SOLICITUD.APROBADA,
        fechaSolicitud: new Date('2021-06-20T12:00:00Z'),
        fechaResolucion: new Date('2021-06-20T12:00:00Z'),
      },
    });

    const reporte = (await consultar().expect(200)).body as Reporte;

    expect(indicador(reporte, 'OE1').total).toBe(1);
  });

  it('E14-H1 · OE2: una solicitud sin resolver que aún está dentro de sus 48 h no cuenta en el total', async () => {
    // En un período que incluye hoy puede haber otros datos: se mide cuánto cambia el total
    const hoy = new Date().toISOString().slice(0, 10);
    const ayer = new Date(Date.now() - 24 * HORA_MS).toISOString().slice(0, 10);
    const totalOe2 = async () =>
      indicador((await consultar(ayer, hoy).expect(200)).body as Reporte, 'OE2')
        .total;
    const antes = await totalOe2();

    await nuevaSolicitud({
      estado: ESTADOS_SOLICITUD.PENDIENTE,
      presentada: new Date(Date.now() - HORA_MS).toISOString(),
    });

    expect(await totalOe2()).toBe(antes);
  });

  it('E14-H1 · OE1: una compra sin pagar o cancelada no cuenta como compra', async () => {
    const cuenta = await nuevaSolicitud({
      estado: ESTADOS_SOLICITUD.APROBADA,
      presentada: '2021-06-05T12:00:00Z',
      horasHastaResolver: 1,
    });
    await nuevoPedido(
      cuenta,
      '2021-06-06T12:00:00Z',
      ESTADOS_PEDIDO.PENDIENTE_PAGO,
    );
    await nuevoPedido(cuenta, '2021-06-07T12:00:00Z', ESTADOS_PEDIDO.CANCELADO);

    const reporte = (await consultar().expect(200)).body as Reporte;

    expect(indicador(reporte, 'OE1')).toMatchObject({
      cumplidos: 0,
      total: 1,
      porcentaje: 0,
    });
  });

  it('E14-H1 · OE2: cumple la resuelta en 48 h o menos (aprobada o rechazada); una resuelta tarde o sin resolver pasadas las 48 h no cumple', async () => {
    await nuevaSolicitud({
      estado: ESTADOS_SOLICITUD.RECHAZADA,
      presentada: '2021-06-01T12:00:00Z',
      horasHastaResolver: 48,
    });
    await nuevaSolicitud({
      estado: ESTADOS_SOLICITUD.APROBADA,
      presentada: '2021-06-02T12:00:00Z',
      horasHastaResolver: 49,
    });
    await nuevaSolicitud({
      estado: ESTADOS_SOLICITUD.REVISION_MANUAL,
      presentada: '2021-06-03T12:00:00Z',
    });
    await nuevaSolicitud({
      estado: ESTADOS_SOLICITUD.PENDIENTE,
      presentada: '2021-06-04T12:00:00Z',
    });

    const reporte = (await consultar().expect(200)).body as Reporte;

    expect(indicador(reporte, 'OE2')).toMatchObject({
      cumplidos: 1,
      total: 4,
      porcentaje: 25,
    });
  });

  it('E14-H1 · los días se cortan a medianoche de Chile, con ambos extremos incluidos', async () => {
    // 1 de junio 00:30 en Chile (04:30 UTC) entra; 30 de junio 23:30 en Chile (1 jul 03:30 UTC) entra
    await nuevoProducto(ORIGENES_DESCRIPCION.IA, '2021-06-01T04:30:00Z');
    await nuevoProducto(ORIGENES_DESCRIPCION.IA, '2021-07-01T03:30:00Z');
    // 31 de mayo 23:30 en Chile y 1 de julio 00:30 en Chile quedan fuera
    await nuevoProducto(ORIGENES_DESCRIPCION.IA, '2021-06-01T03:30:00Z');
    await nuevoProducto(ORIGENES_DESCRIPCION.IA, '2021-07-01T04:30:00Z');

    const reporte = (await consultar().expect(200)).body as Reporte;

    expect(indicador(reporte, 'OE3').total).toBe(2);
  });

  it('E14-H1 · CA2 período sin datos: cada indicador indica que no hay datos para calcularlo', async () => {
    const reporte = (await consultar().expect(200)).body as Reporte;

    expect(reporte.indicadores).toEqual([
      expect.objectContaining({
        codigo: 'OE1',
        meta: 30,
        porcentaje: null,
        sinDatos: true,
      }),
      expect.objectContaining({
        codigo: 'OE2',
        meta: 70,
        porcentaje: null,
        sinDatos: true,
      }),
      expect.objectContaining({
        codigo: 'OE3',
        meta: 80,
        porcentaje: null,
        sinDatos: true,
      }),
    ]);
  });

  it('E14-H1 · período: fechas faltantes o inválidas, rango invertido o de más de 366 días responden 400', async () => {
    await servidor()
      .get(RUTA)
      .auth(tokenAdministrador, { type: 'bearer' })
      .expect(400);
    await consultar('2021-02-30', '2021-03-31').expect(400);
    await consultar('2021-06-30', '2021-06-01').expect(400);
    await consultar('2020-01-01', '2021-01-02').expect(400);
    await consultar('0000-01-01', '0000-01-02').expect(400);
  });

  it('E14-H1 · CA3 acceso restringido: sin sesión responde 401', async () => {
    await servidor()
      .get(RUTA)
      .query({ desde: DESDE, hasta: HASTA })
      .expect(401);
  });

  it('E14-H1 · CA3 acceso restringido: bodeguero, vendedor, cliente y profesional reciben 403', async () => {
    for (const rol of [
      ROLES.BODEGUERO,
      ROLES.VENDEDOR,
      ROLES.CLIENTE,
      ROLES.PROFESIONAL,
    ]) {
      await consultar(DESDE, HASTA, await tokenDe(rol)).expect(403);
    }
  });
});
