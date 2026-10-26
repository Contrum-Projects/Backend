import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoRecuperacionContrasena,
} from '../src/colas/colas.js';
import { ROLES } from '../src/common/dominio/roles.js';
import { TIPOS_TOKEN } from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { hashearTokenCorreo } from '../src/modulos/cuentas/tokens.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const NUEVA = 'Nueva1234';
const SOLICITAR = '/api/cuentas/recuperar-contrasena';
const RESTABLECER = '/api/cuentas/restablecer-contrasena';

describe('Cuentas · recuperación de la contraseña (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let correos: Queue<TrabajoRecuperacionContrasena>;
  let redis: Redis;
  let hashContrasena: string;
  const correosCreados: string[] = [];

  const crearCuenta = async (
    datos: { fechaVerificacionCorreo?: Date | null; activo?: boolean } = {},
  ) => {
    const email = `e2e-recuperar-${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Camila',
        apellido: 'Rojas',
        email,
        contrasenaHash: hashContrasena,
        rol: ROLES.CLIENTE,
        fechaVerificacionCorreo: new Date(),
        ...datos,
      },
    });
    return email;
  };

  const solicitar = (email: string) =>
    request(app.getHttpServer()).post(SOLICITAR).send({ email });

  const restablecer = (token: string, contrasena = NUEVA) =>
    request(app.getHttpServer())
      .post(RESTABLECER)
      .send({ token, contrasena, confirmacionContrasena: contrasena });

  const iniciarSesion = (email: string, contrasena: string) =>
    request(app.getHttpServer())
      .post('/api/cuentas/sesion')
      .send({ email, contrasena });

  const trabajosDe = async (email: string) => {
    const trabajos: Job<TrabajoRecuperacionContrasena>[] =
      await correos.getJobs(['prioritized', 'waiting', 'delayed']);
    return trabajos.filter(
      (t) =>
        t.name === TRABAJOS_CORREO.RECUPERACION_CONTRASENA &&
        t.data.destinatario === email,
    );
  };

  /** Token del último correo de recuperación encolado para esa cuenta. */
  const tokenDelCorreo = async (email: string): Promise<string> => {
    const trabajos = await trabajosDe(email);
    const ultimo = trabajos.sort((a, b) => b.timestamp - a.timestamp)[0];
    return new URL(ultimo.data.enlace).searchParams.get('token')!;
  };

  /** Pide el enlace y devuelve el token que trae el correo. */
  const tokenRecibido = async (email: string): Promise<string> => {
    await solicitar(email).expect(200);
    return tokenDelCorreo(email);
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    correos = app.get(getQueueToken(COLAS.CORREOS));
    redis = app.get(REDIS);
    hashContrasena = await argon2.hash(CONTRASENA);
  });

  // Todas las peticiones salen de la misma IP: cada prueba parte sin contadores
  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
  });

  afterAll(async () => {
    for (const email of correosCreados) {
      for (const trabajo of await trabajosDe(email)) await trabajo.remove();
    }
    const usuarios = await prisma.usuario.findMany({
      where: { email: { in: correosCreados } },
      select: { id: true },
    });
    const ids = usuarios.map((u) => u.id);
    await prisma.notificacion.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('E1-H4 · solicitud de recuperación: guarda un token de un uso que vence y encola el correo con el enlace', async () => {
    const email = await crearCuenta();

    const respuesta = await solicitar(email.toUpperCase()).expect(200);

    expect(respuesta.body.mensaje).toMatch(/Si el correo tiene una cuenta/);
    const token = await tokenDelCorreo(email);
    const registro = await prisma.tokenCorreo.findUniqueOrThrow({
      where: { tokenHash: hashearTokenCorreo(token) },
    });
    expect(registro.tipo).toBe(TIPOS_TOKEN.RECUPERACION_CONTRASENA);
    expect(registro.fechaUso).toBeNull();
    expect(registro.fechaExpiracion.getTime()).toBeGreaterThan(Date.now());
    expect(registro.fechaExpiracion.getTime()).toBeLessThanOrEqual(
      Date.now() + 60 * 60 * 1000,
    );
  });

  it('E1-H4 · correo sin cuenta o cuenta desactivada: misma respuesta y no se envía nada', async () => {
    const conCuenta = await solicitar(await crearCuenta()).expect(200);
    const desactivada = await crearCuenta({ activo: false });
    const sinCuenta = `e2e-recuperar-${randomUUID()}@prueba.cl`;

    const respuestaSinCuenta = await solicitar(sinCuenta).expect(200);
    const respuestaDesactivada = await solicitar(desactivada).expect(200);

    expect(respuestaSinCuenta.body).toEqual(conCuenta.body);
    expect(respuestaDesactivada.body).toEqual(conCuenta.body);
    expect(await trabajosDe(sinCuenta)).toHaveLength(0);
    expect(await trabajosDe(desactivada)).toHaveLength(0);
  });

  it('E1-H4 · cambio de contraseña: la nueva sirve, la anterior no y se cierran las sesiones abiertas', async () => {
    const email = await crearCuenta();
    const sesion = await iniciarSesion(email, CONTRASENA).expect(200);
    const tokenAcceso = (sesion.body as { tokenAcceso: string }).tokenAcceso;
    const token = await tokenRecibido(email);

    const respuesta = await restablecer(token).expect(200);

    expect(respuesta.body.mensaje).toMatch(/contraseña quedó actualizada/);
    await iniciarSesion(email, CONTRASENA).expect(401);
    await iniciarSesion(email, NUEVA).expect(200);
    // El token de acceso anterior deja de servir sin esperar a que caduque (RNF-28)
    await request(app.getHttpServer())
      .get('/api/cuentas/yo')
      .auth(tokenAcceso, { type: 'bearer' })
      .expect(401);
    const registro = await prisma.tokenCorreo.findUniqueOrThrow({
      where: { tokenHash: hashearTokenCorreo(token) },
    });
    expect(registro.fechaUso).toBeInstanceOf(Date);
  });

  it('E1-H4 · cambio de contraseña: una cuenta con el correo sin confirmar queda confirmada', async () => {
    const email = await crearCuenta({ fechaVerificacionCorreo: null });

    await restablecer(await tokenRecibido(email)).expect(200);

    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { email },
    });
    expect(usuario.fechaVerificacionCorreo).toBeInstanceOf(Date);
    await iniciarSesion(email, NUEVA).expect(200);
  });

  it('E1-H4 · token ya usado: rechaza el cambio, pide un enlace nuevo y la contraseña no cambia', async () => {
    const email = await crearCuenta();
    const token = await tokenRecibido(email);
    await restablecer(token).expect(200);

    const respuesta = await restablecer(token, 'Otra12345').expect(400);

    expect(respuesta.body.message).toMatch(/Solicita uno nuevo/);
    await iniciarSesion(email, 'Otra12345').expect(401);
    await iniciarSesion(email, NUEVA).expect(200);
  });

  it('E1-H4 · token vencido: rechaza el cambio y pide un enlace nuevo', async () => {
    const email = await crearCuenta();
    const token = await tokenRecibido(email);
    await prisma.tokenCorreo.update({
      where: { tokenHash: hashearTokenCorreo(token) },
      data: { fechaExpiracion: new Date(Date.now() - 1000) },
    });

    const respuesta = await restablecer(token).expect(400);

    expect(respuesta.body.message).toMatch(/Solicita uno nuevo/);
    await iniciarSesion(email, CONTRASENA).expect(200);
  });

  it('E1-H4 · pedir un enlace nuevo deja sin efecto el anterior', async () => {
    const email = await crearCuenta();
    const primero = await tokenRecibido(email);
    const segundo = await tokenRecibido(email);

    await restablecer(primero).expect(400);
    await restablecer(segundo).expect(200);
  });

  it('E1-H4 · personal con invitación pendiente: recupera, entra con la contraseña nueva y la invitación deja de servir', async () => {
    const email = await crearCuenta({ fechaVerificacionCorreo: null });
    const usuario = await prisma.usuario.update({
      where: { email },
      data: { rol: ROLES.VENDEDOR },
    });
    const invitacion = `invitacion-${randomUUID()}`;
    await prisma.tokenCorreo.create({
      data: {
        usuarioId: usuario.id,
        tipo: TIPOS_TOKEN.INVITACION_PERSONAL,
        tokenHash: hashearTokenCorreo(invitacion),
        fechaExpiracion: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await restablecer(await tokenRecibido(email)).expect(200);

    await iniciarSesion(email, NUEVA).expect(200);
    await request(app.getHttpServer())
      .post('/api/personal/invitacion/aceptar')
      .send({
        token: invitacion,
        contrasena: 'Otra12345',
        confirmacionContrasena: 'Otra12345',
      })
      .expect(400);
    await iniciarSesion(email, NUEVA).expect(200);
  });

  it('E1-H4 · cuenta desactivada después de pedir el enlace: rechaza el cambio y no gasta el token', async () => {
    const email = await crearCuenta();
    const token = await tokenRecibido(email);
    await prisma.usuario.update({ where: { email }, data: { activo: false } });

    await restablecer(token).expect(400);

    const registro = await prisma.tokenCorreo.findUniqueOrThrow({
      where: { tokenHash: hashearTokenCorreo(token) },
    });
    expect(registro.fechaUso).toBeNull();
  });

  it('E1-H4 · el token de confirmación del correo no sirve para cambiar la contraseña', async () => {
    const email = await crearCuenta({ fechaVerificacionCorreo: null });
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { email },
    });
    const token = `confirmacion-${randomUUID()}`;
    await prisma.tokenCorreo.create({
      data: {
        usuarioId: usuario.id,
        tipo: TIPOS_TOKEN.CONFIRMACION_CORREO,
        tokenHash: hashearTokenCorreo(token),
        fechaExpiracion: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await restablecer(token).expect(400);
  });

  it('RNF-09 · más de 3 solicitudes por hora para el mismo correo: misma respuesta y no se envía otro enlace', async () => {
    const email = await crearCuenta();
    const primero = await tokenRecibido(email);
    await solicitar(email).expect(200);
    const tercero = await tokenRecibido(email);

    const cuarta = await solicitar(email).expect(200);

    expect(cuarta.body.mensaje).toMatch(/Si el correo tiene una cuenta/);
    expect(await trabajosDe(email)).toHaveLength(3);
    // La cuarta no anuló el último enlace: sigue sirviendo
    expect(primero).not.toBe(tercero);
    await restablecer(tercero).expect(200);
  });

  it('RNF-09 · más de 5 solicitudes en 15 minutos desde la misma IP: 429', async () => {
    const email = await crearCuenta();
    for (let i = 0; i < 5; i++) await solicitar(email).expect(200);

    await solicitar(email).expect(429);
  });

  it('RNF-09 · más de 5 intentos de cambio en 15 minutos desde la misma IP: 429', async () => {
    for (let i = 0; i < 5; i++) await restablecer(`falso-${i}`).expect(400);

    await restablecer('falso-6').expect(429);
  });
});
