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
  ESTADOS_NOTIFICACION,
  ESTADOS_PEDIDO,
  TIPOS_CAMPANA,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
  TIPOS_NOTIFICACION,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import type { ReportePeriodoCampanas } from '../src/modulos/reportes/reporte-campanas.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA_CARRITOS = '/api/reportes/carritos-abandonados';
const RUTA_CAMPANAS = '/api/reportes/campanas';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-reporte-marketing';
const PREFIJO_CORREO = 'e2e-reporte-marketing-';

interface ReporteCarritos {
  desde: string;
  hasta: string;
  meses: {
    mes: string;
    abandonados: number;
    recuperados: number;
    porcentajeRecuperados: number | null;
  }[];
  total: {
    abandonados: number;
    recuperados: number;
    porcentajeRecuperados: number | null;
  };
}

interface ResultadoCampana {
  id: number;
  tipo: string;
  asunto: string;
  fechaEnvio: string | null;
  envios: Record<string, number>;
}

/**
 * Los recordatorios de estas pruebas van en junio y julio de 2031, meses sin otros recordatorios en
 * la base: así los conteos son exactos. En invierno Chile está en UTC-4. El 2 de junio de 2031 es
 * lunes.
 */
describe('Reportes · carritos abandonados y resultado de campañas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let tokenAdministrador: string;
  let administradorId: number;

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
        aceptaMarketingEmail: true,
      },
    });
    return { id: usuario.id, email };
  };

  const tokenDe = async (email: string) => {
    const respuesta = await servidor()
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  const tokenDeRol = async (rol: Rol) =>
    tokenDe((await nuevaCuenta(rol)).email);

  const recordatorio = (
    usuarioId: number,
    fecha: string,
    estadoEnvio: string = ESTADOS_NOTIFICACION.ENVIADA,
  ) =>
    prisma.notificacion.create({
      data: {
        usuarioId,
        tipo: TIPOS_NOTIFICACION.RECORDATORIO_CARRITO,
        asunto: 'Tus productos te esperan',
        estadoEnvio,
        fechaCreacion: new Date(fecha),
      },
    });

  const pedido = (
    usuarioId: number,
    fecha: string,
    estado: string = ESTADOS_PEDIDO.PAGADO,
  ) =>
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

  const consultarCarritos = (
    desde: string,
    hasta: string,
    token = tokenAdministrador,
  ) =>
    servidor()
      .get(RUTA_CARRITOS)
      .query({ desde, hasta })
      .auth(token, { type: 'bearer' });

  const consultarCampana = (id: number | string, token = tokenAdministrador) =>
    servidor().get(`${RUTA_CAMPANAS}/${id}`).auth(token, { type: 'bearer' });

  const nuevaCampana = (fechaEncolado: Date | null) =>
    prisma.campana.create({
      data: {
        usuarioId: administradorId,
        tipo: TIPOS_CAMPANA.ENVIO_UNICO,
        asunto: `${PREFIJO} ofertas`,
        cuerpo: 'Hola',
        fechaEncolado,
      },
    });

  const limpiar = async () => {
    const deLaPrueba = { usuario: { email: { startsWith: PREFIJO_CORREO } } };
    await prisma.notificacion.deleteMany({ where: deLaPrueba });
    await prisma.campana.deleteMany({
      where: { asunto: { startsWith: PREFIJO } },
    });
    await prisma.pedido.deleteMany({ where: deLaPrueba });
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: PREFIJO_CORREO } },
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
    await limpiar();

    const administrador = await nuevaCuenta(ROLES.ADMINISTRADOR);
    administradorId = administrador.id;
    tokenAdministrador = await tokenDe(administrador.email);
  });

  // Todas las peticiones salen de la misma IP: cada prueba parte sin contadores
  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  it('E14-H3 · carritos por mes: devuelve por mes cuántos se abandonaron y cuántos terminaron en una compra pagada', async () => {
    // Cuenta A: una serie de tres recordatorios (uno cancelado) y pagó dentro de los 7 días
    const a = await nuevaCuenta(ROLES.CLIENTE);
    await recordatorio(a.id, '2031-06-02T14:00:00Z');
    await recordatorio(a.id, '2031-06-03T13:00:00Z');
    await recordatorio(
      a.id,
      '2031-06-05T13:00:00Z',
      ESTADOS_NOTIFICACION.CANCELADA,
    );
    await pedido(a.id, '2031-06-04T15:00:00Z');
    // Cuenta A, otra semana: abandona otra vez y su pedido no se paga o se cancela
    await recordatorio(a.id, '2031-06-16T14:00:00Z');
    await pedido(a.id, '2031-06-17T15:00:00Z', ESTADOS_PEDIDO.PENDIENTE_PAGO);
    await pedido(a.id, '2031-06-18T15:00:00Z', ESTADOS_PEDIDO.CANCELADO);
    // Cuenta B: 30 de junio a las 23:30 de Chile (en UTC ya es julio); paga pasados los 7 días
    const b = await nuevaCuenta(ROLES.PROFESIONAL);
    await recordatorio(b.id, '2031-07-01T03:30:00Z');
    await pedido(b.id, '2031-07-10T15:00:00Z');
    // Cuenta C: abandona en julio y paga al día siguiente; su pedido ya despachado cuenta
    const c = await nuevaCuenta(ROLES.CLIENTE);
    await recordatorio(c.id, '2031-07-07T14:00:00Z');
    await pedido(c.id, '2031-07-08T15:00:00Z', ESTADOS_PEDIDO.DESPACHADO);

    const respuesta = await consultarCarritos('2031-06', '2031-08').expect(200);

    expect(respuesta.body as ReporteCarritos).toEqual({
      desde: '2031-06',
      hasta: '2031-08',
      meses: [
        // SCRUM-150: el porcentaje recuperado lo calcula el backend; sin abandonos, null
        {
          mes: '2031-06',
          abandonados: 3,
          recuperados: 1,
          porcentajeRecuperados: 33,
        },
        {
          mes: '2031-07',
          abandonados: 1,
          recuperados: 1,
          porcentajeRecuperados: 100,
        },
        {
          mes: '2031-08',
          abandonados: 0,
          recuperados: 0,
          porcentajeRecuperados: null,
        },
      ],
      total: { abandonados: 4, recuperados: 2, porcentajeRecuperados: 50 },
    });

    // Solo julio: lo de junio no cuenta
    const julio = (await consultarCarritos('2031-07', '2031-07').expect(200))
      .body as ReporteCarritos;
    expect(julio.meses).toEqual([
      {
        mes: '2031-07',
        abandonados: 1,
        recuperados: 1,
        porcentajeRecuperados: 100,
      },
    ]);
  });

  it('E14-H3 · carritos por mes: meses faltantes o inválidos, rango invertido o de más de 24 meses responden 400', async () => {
    await servidor()
      .get(RUTA_CARRITOS)
      .auth(tokenAdministrador, { type: 'bearer' })
      .expect(400);
    await consultarCarritos('2031-13', '2031-12').expect(400);
    await consultarCarritos('2031-6', '2031-07').expect(400);
    await consultarCarritos('2031-07', '2031-06').expect(400);
    // PostgreSQL no tiene año 0: debe ser 400, no 500
    await consultarCarritos('0000-01', '0000-02').expect(400);
    await consultarCarritos('2030-01', '2032-01').expect(400);
  });

  it('E14-H3 · resultado de una campaña: devuelve los correos enviados, abiertos, con clic, rebotados, cancelados y fallidos', async () => {
    const envio = new Date('2031-06-10T14:00:00Z');
    const campana = await nuevaCampana(envio);
    const destinatario = await nuevaCuenta(ROLES.CLIENTE);
    const correo = (
      estadoEnvio: string,
      seguimiento: { apertura?: boolean; clic?: boolean } = {},
    ) =>
      prisma.notificacion.create({
        data: {
          usuarioId: destinatario.id,
          campanaId: campana.id,
          tipo: TIPOS_NOTIFICACION.CAMPANA,
          asunto: campana.asunto,
          estadoEnvio,
          fechaApertura: seguimiento.apertura ? envio : null,
          fechaClic: seguimiento.clic ? envio : null,
        },
      });
    await correo(ESTADOS_NOTIFICACION.ENVIADA);
    await correo(ESTADOS_NOTIFICACION.ENVIADA, { apertura: true });
    await correo(ESTADOS_NOTIFICACION.ENVIADA, { apertura: true, clic: true });
    await correo(ESTADOS_NOTIFICACION.REBOTADA);
    await correo(ESTADOS_NOTIFICACION.CANCELADA);
    await correo(ESTADOS_NOTIFICACION.FALLIDA);
    await correo(ESTADOS_NOTIFICACION.PENDIENTE);

    const respuesta = await consultarCampana(campana.id).expect(200);

    expect(respuesta.body as ResultadoCampana).toEqual({
      id: campana.id,
      tipo: TIPOS_CAMPANA.ENVIO_UNICO,
      asunto: campana.asunto,
      fechaEnvio: envio.toISOString(),
      envios: {
        total: 7,
        pendientes: 1,
        enviados: 3,
        abiertos: 2,
        clics: 1,
        rebotados: 1,
        cancelados: 1,
        fallidos: 1,
      },
    });
  });

  it('E14-H3 · resultado de una campaña: un borrador responde 409 y una campaña que no existe, 404', async () => {
    const borrador = await nuevaCampana(null);

    await consultarCampana(borrador.id).expect(409);
    await consultarCampana(2_000_000_000).expect(404);
    await consultarCampana('abc').expect(404);
  });

  it('SCRUM-150 · campañas del período: las enviadas en él y el saludo de cumpleaños por mes, las más recientes primero, con porcentajes sobre los enviados', async () => {
    const destinatario = await nuevaCuenta(ROLES.CLIENTE);
    const correo = (
      datos: { campanaId?: number; tipo?: string; fecha?: string },
      estadoEnvio: string,
      seguimiento: { apertura?: boolean; clic?: boolean } = {},
    ) =>
      prisma.notificacion.create({
        data: {
          usuarioId: destinatario.id,
          campanaId: datos.campanaId ?? null,
          tipo: datos.tipo ?? TIPOS_NOTIFICACION.CAMPANA,
          asunto: 'x',
          estadoEnvio,
          fechaCreacion: new Date(datos.fecha ?? '2031-09-10T14:00:00Z'),
          fechaApertura: seguimiento.apertura ? new Date() : null,
          fechaClic: seguimiento.clic ? new Date() : null,
        },
      });
    // 3 de septiembre: 3 enviados (2 abiertos, 1 con clic), 1 rebotado, 1 cancelado
    const septiembre = await nuevaCampana(new Date('2031-09-03T15:00:00Z'));
    await correo({ campanaId: septiembre.id }, ESTADOS_NOTIFICACION.ENVIADA);
    await correo({ campanaId: septiembre.id }, ESTADOS_NOTIFICACION.ENVIADA, {
      apertura: true,
    });
    await correo({ campanaId: septiembre.id }, ESTADOS_NOTIFICACION.ENVIADA, {
      apertura: true,
      clic: true,
    });
    await correo({ campanaId: septiembre.id }, ESTADOS_NOTIFICACION.REBOTADA);
    await correo({ campanaId: septiembre.id }, ESTADOS_NOTIFICACION.CANCELADA);
    // 20 de septiembre: sin correos todavía
    const masNueva = await nuevaCampana(new Date('2031-09-20T15:00:00Z'));
    // Fuera del período (31 de agosto a las 23:30 de Chile, en UTC ya es septiembre) y un borrador
    await nuevaCampana(new Date('2031-09-01T02:30:00Z'));
    await nuevaCampana(null);
    // Saludos de cumpleaños: septiembre (uno abierto de dos) y octubre
    const saludo = { tipo: TIPOS_NOTIFICACION.CUMPLEANOS };
    await correo(
      { ...saludo, fecha: '2031-09-15T14:00:00Z' },
      ESTADOS_NOTIFICACION.ENVIADA,
      { apertura: true },
    );
    await correo(
      { ...saludo, fecha: '2031-09-16T14:00:00Z' },
      ESTADOS_NOTIFICACION.ENVIADA,
    );
    await correo(
      { ...saludo, fecha: '2031-10-02T14:00:00Z' },
      ESTADOS_NOTIFICACION.FALLIDA,
    );

    const respuesta = await servidor()
      .get(RUTA_CAMPANAS)
      .query({ desde: '2031-09-01', hasta: '2031-10-31' })
      .auth(tokenAdministrador, { type: 'bearer' })
      .expect(200);

    const filas = (respuesta.body as ReportePeriodoCampanas).campanas.map(
      ({ id: _id, segmento: _segmento, ...fila }) => fila,
    );
    expect(filas).toEqual([
      {
        nombre: 'Saludo de cumpleaños',
        automatica: true,
        fecha: '2031-10',
        enviados: 0,
        porcentajeAbiertos: null,
        porcentajeClic: null,
        rebotados: 0,
        cancelados: 0,
        fallidos: 1,
      },
      {
        nombre: masNueva.asunto,
        automatica: false,
        fecha: '2031-09-20T15:00:00.000Z',
        enviados: 0,
        porcentajeAbiertos: null,
        porcentajeClic: null,
        rebotados: 0,
        cancelados: 0,
        fallidos: 0,
      },
      {
        nombre: septiembre.asunto,
        automatica: false,
        fecha: '2031-09-03T15:00:00.000Z',
        enviados: 3,
        porcentajeAbiertos: 67,
        porcentajeClic: 33,
        rebotados: 1,
        cancelados: 1,
        fallidos: 0,
      },
      {
        nombre: 'Saludo de cumpleaños',
        automatica: true,
        fecha: '2031-09',
        enviados: 2,
        porcentajeAbiertos: 50,
        porcentajeClic: 0,
        rebotados: 0,
        cancelados: 0,
        fallidos: 0,
      },
    ]);
    const cuerpo = respuesta.body as ReportePeriodoCampanas;
    expect(cuerpo.desde).toBe('2031-09-01');
    expect(cuerpo.campanas[1]).toMatchObject({
      id: masNueva.id,
      segmento: { tipos: [], categorias: [], marcas: [] },
    });
    expect(cuerpo.campanas[0].segmento).toBeNull();
  });

  it('SCRUM-150 · campañas del período: fechas faltantes o inválidas, rango invertido o de más de 366 días responden 400', async () => {
    const consultar = (query: object) =>
      servidor()
        .get(RUTA_CAMPANAS)
        .query(query)
        .auth(tokenAdministrador, { type: 'bearer' });
    await consultar({}).expect(400);
    await consultar({ desde: '2031-09-31', hasta: '2031-10-01' }).expect(400);
    await consultar({ desde: '2031-10-01', hasta: '2031-09-01' }).expect(400);
    await consultar({ desde: '2030-01-01', hasta: '2031-06-01' }).expect(400);
  });

  it('RNF-03 · reportes de marketing: sin sesión responden 401', async () => {
    await servidor()
      .get(RUTA_CARRITOS)
      .query({ desde: '2031-06', hasta: '2031-07' })
      .expect(401);
    await servidor().get(`${RUTA_CAMPANAS}/1`).expect(401);
    await servidor()
      .get(RUTA_CAMPANAS)
      .query({ desde: '2031-06-01', hasta: '2031-06-30' })
      .expect(401);
  });

  it('RNF-03 · reportes de marketing: bodeguero, vendedor, cliente y profesional reciben 403', async () => {
    for (const rol of [
      ROLES.BODEGUERO,
      ROLES.VENDEDOR,
      ROLES.CLIENTE,
      ROLES.PROFESIONAL,
    ]) {
      const token = await tokenDeRol(rol);
      await consultarCarritos('2031-06', '2031-07', token).expect(403);
      await consultarCampana(1, token).expect(403);
      await servidor()
        .get(RUTA_CAMPANAS)
        .query({ desde: '2031-06-01', hasta: '2031-06-30' })
        .auth(token, { type: 'bearer' })
        .expect(403);
    }
  });
});
