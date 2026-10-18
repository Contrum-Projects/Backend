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
import { COLAS, type TrabajoInvitacionPersonal } from '../src/colas/colas.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/personal';
/** Ruta protegida que sirve para comprobar si un token de acceso aún sirve. */
const RUTA_PROTEGIDA = '/api/cuentas/sesion/todas';

describe('Personal · crear y desactivar cuentas del personal (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let correos: Queue<TrabajoInvitacionPersonal>;
  let hashContrasena: string;
  let tokenAdmin: string;
  let codigoAdmin: string;
  const correosCreados: string[] = [];

  const nuevoCorreo = () => {
    const email = `e2e-personal-${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    return email;
  };

  /** Cuenta con contraseña conocida y correo confirmado, creada en la base. */
  const crearCuenta = async (rol: Rol) => {
    const email = nuevoCorreo();
    const usuario = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Prueba',
        apellido: 'E2E',
        email,
        contrasenaHash: hashContrasena,
        rol,
        fechaVerificacionCorreo: new Date(),
      },
    });
    return { email, codigoPublico: usuario.codigoPublico };
  };

  const iniciar = (email: string) =>
    request(app.getHttpServer())
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA });

  const tokenDe = async (email: string) =>
    ((await iniciar(email).expect(200)).body as { tokenAcceso: string })
      .tokenAcceso;

  const comoAdmin = (metodo: 'get' | 'post', ruta: string) =>
    request(app.getHttpServer())
      [metodo](ruta)
      .auth(tokenAdmin, { type: 'bearer' });

  /** Token en claro del último enlace de invitación encolado para ese correo. */
  const tokenInvitacion = async (email: string) => {
    const trabajos: Job<TrabajoInvitacionPersonal>[] = await correos.getJobs([
      'prioritized',
      'waiting',
      'delayed',
    ]);
    const trabajo = trabajos
      .filter((t) => t.data.destinatario === email)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    return new URL(trabajo.data.enlace).searchParams.get('token')!;
  };

  const aceptar = (token: string) =>
    request(app.getHttpServer()).post(`${RUTA}/invitacion/aceptar`).send({
      token,
      contrasena: CONTRASENA,
      confirmacionContrasena: CONTRASENA,
    });

  const crearPersonal = (email: string, rol: Rol = ROLES.VENDEDOR) =>
    comoAdmin('post', RUTA).send({
      nombre: 'Javiera',
      apellido: 'Muñoz',
      email,
      rol,
    });

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    correos = app.get(getQueueToken(COLAS.CORREOS));
    hashContrasena = await argon2.hash(CONTRASENA);
  });

  // Todas las peticiones salen de la misma IP: cada prueba parte sin contadores
  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    const admin = await crearCuenta(ROLES.ADMINISTRADOR);
    codigoAdmin = admin.codigoPublico;
    tokenAdmin = await tokenDe(admin.email);
  });

  afterAll(async () => {
    const trabajos = await correos.getJobs([
      'prioritized',
      'waiting',
      'delayed',
    ]);
    for (const trabajo of trabajos) {
      if (correosCreados.includes(trabajo.data.destinatario)) {
        await trabajo.remove();
      }
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

  it('E13-H1 · cuenta creada: el administrador la crea con un único rol, la persona define su contraseña y entra al panel', async () => {
    const email = nuevoCorreo();

    const creada = await crearPersonal(email, ROLES.BODEGUERO).expect(201);
    expect(creada.body).toMatchObject({
      email,
      rol: ROLES.BODEGUERO,
      activo: true,
      invitacionPendiente: true,
    });
    // Antes de aceptar la invitación no hay contraseña con la que entrar
    await iniciar(email).expect(401);

    await aceptar(await tokenInvitacion(email)).expect(200);

    const sesion = await iniciar(email).expect(200);
    expect((sesion.body as { usuario: { rol: string } }).usuario.rol).toBe(
      ROLES.BODEGUERO,
    );
    const lista = await comoAdmin('get', RUTA).expect(200);
    expect(
      (lista.body as { email: string; invitacionPendiente: boolean }[]).find(
        (c) => c.email === email,
      ),
    ).toMatchObject({ rol: ROLES.BODEGUERO, invitacionPendiente: false });
  });

  it('E13-H1 · cuenta creada: un administrador invitado entra a las rutas del panel de su rol', async () => {
    const email = nuevoCorreo();
    await crearPersonal(email, ROLES.ADMINISTRADOR).expect(201);
    await aceptar(await tokenInvitacion(email)).expect(200);

    const token = await tokenDe(email);
    await request(app.getHttpServer())
      .get(RUTA)
      .auth(token, { type: 'bearer' })
      .expect(200);
  });

  it('E13-H1 · cuenta creada: el enlace de la invitación es de un solo uso', async () => {
    const email = nuevoCorreo();
    await crearPersonal(email).expect(201);
    const token = await tokenInvitacion(email);

    await aceptar(token).expect(200);
    await aceptar(token).expect(400);
  });

  it('E13-H1 · cuenta creada: correo de otra cuenta → 409; rol de cliente o profesional → 400', async () => {
    const existente = await crearCuenta(ROLES.CLIENTE);

    await crearPersonal(existente.email.toUpperCase()).expect(409);
    await crearPersonal(nuevoCorreo(), ROLES.CLIENTE).expect(400);
    await crearPersonal(nuevoCorreo(), ROLES.PROFESIONAL).expect(400);
  });

  it('RNF-03 · solo el administrador gestiona el personal: sin sesión 401; cliente o vendedor 403', async () => {
    await request(app.getHttpServer()).get(RUTA).expect(401);
    await request(app.getHttpServer())
      .post(`${RUTA}/${codigoAdmin}/invitacion`)
      .expect(401);
    for (const rol of [ROLES.CLIENTE, ROLES.VENDEDOR]) {
      const token = await tokenDe((await crearCuenta(rol)).email);
      await request(app.getHttpServer())
        .post(RUTA)
        .auth(token, { type: 'bearer' })
        .send({ nombre: 'X', apellido: 'Y', email: nuevoCorreo(), rol })
        .expect(403);
      await request(app.getHttpServer())
        .post(`${RUTA}/${codigoAdmin}/desactivar`)
        .auth(token, { type: 'bearer' })
        .expect(403);
      await request(app.getHttpServer())
        .post(`${RUTA}/${codigoAdmin}/invitacion`)
        .auth(token, { type: 'bearer' })
        .expect(403);
    }
  });

  it('E13-H1 · cuenta desactivada: cierra todas sus sesiones y le quita el acceso de inmediato', async () => {
    const vendedor = await crearCuenta(ROLES.VENDEDOR);
    const tokens = [
      await tokenDe(vendedor.email),
      await tokenDe(vendedor.email),
    ];

    await comoAdmin(
      'post',
      `${RUTA}/${vendedor.codigoPublico}/desactivar`,
    ).expect(204);

    const sesiones = await prisma.sesion.findMany({
      where: { usuario: { codigoPublico: vendedor.codigoPublico } },
    });
    expect(sesiones).toHaveLength(2);
    expect(sesiones.every((s) => s.fechaRevocacion !== null)).toBe(true);
    for (const token of tokens) {
      await request(app.getHttpServer())
        .delete(RUTA_PROTEGIDA)
        .auth(token, { type: 'bearer' })
        .expect(401);
    }
    const lista = await comoAdmin('get', RUTA).expect(200);
    expect(
      (lista.body as { codigoPublico: string; activo: boolean }[]).find(
        (c) => c.codigoPublico === vendedor.codigoPublico,
      )?.activo,
    ).toBe(false);
  });

  it('E13-H1 · ingreso con cuenta desactivada: rechaza el inicio de sesión y la invitación pendiente', async () => {
    const vendedor = await crearCuenta(ROLES.VENDEDOR);
    await comoAdmin(
      'post',
      `${RUTA}/${vendedor.codigoPublico}/desactivar`,
    ).expect(204);

    const rechazo = await iniciar(vendedor.email).expect(403);
    expect((rechazo.body as { message: string }).message).toBe(
      'Tu cuenta está desactivada.',
    );

    const invitado = nuevoCorreo();
    const creada = await crearPersonal(invitado).expect(201);
    const token = await tokenInvitacion(invitado);
    await comoAdmin(
      'post',
      `${RUTA}/${(creada.body as { codigoPublico: string }).codigoPublico}/desactivar`,
    ).expect(204);
    await aceptar(token).expect(400);
  });

  it('E13-H1 · cuenta desactivada: el administrador no puede desactivarse; código inexistente 404 y mal formado 400', async () => {
    await comoAdmin('post', `${RUTA}/${codigoAdmin}/desactivar`).expect(409);
    await comoAdmin('post', `${RUTA}/${randomUUID()}/desactivar`).expect(404);
    await comoAdmin('post', `${RUTA}/123/desactivar`).expect(400);
    // Una cuenta de cliente no se gestiona desde aquí
    const cliente = await crearCuenta(ROLES.CLIENTE);
    await comoAdmin(
      'post',
      `${RUTA}/${cliente.codigoPublico}/desactivar`,
    ).expect(404);
  });

  it('E13-H1 · reenviar invitación: el enlace anterior deja de servir y el nuevo funciona', async () => {
    const email = nuevoCorreo();
    const creada = await crearPersonal(email).expect(201);
    const codigo = (creada.body as { codigoPublico: string }).codigoPublico;
    const anterior = await tokenInvitacion(email);

    await comoAdmin('post', `${RUTA}/${codigo}/invitacion`).expect(204);
    const nuevo = await tokenInvitacion(email);
    expect(nuevo).not.toBe(anterior);

    await aceptar(anterior).expect(400);
    await aceptar(nuevo).expect(200);
    // Ya definió su contraseña: no se reenvía
    await comoAdmin('post', `${RUTA}/${codigo}/invitacion`).expect(409);
  });
});
