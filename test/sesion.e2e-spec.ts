import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { ROLES } from '../src/common/dominio/roles.js';
import { configurarApp } from '../src/configurar-app.js';
import { hashearTokenSesion } from '../src/modulos/cuentas/tokens.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/cuentas/sesion';

describe('Cuentas · inicio de sesión (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let jwt: JwtService;
  let hashContrasena: string;
  const correosCreados: string[] = [];

  /** Crea una cuenta directamente en la base, verificada salvo que se indique. */
  const crearCuenta = async (
    cambios: { activo?: boolean; verificada?: boolean } = {},
  ) => {
    const email = `e2e-sesion-${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    return prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Camila',
        apellido: 'Rojas',
        email,
        contrasenaHash: hashContrasena,
        rol: ROLES.CLIENTE,
        activo: cambios.activo ?? true,
        fechaVerificacionCorreo:
          cambios.verificada === false ? null : new Date(),
      },
    });
  };

  const iniciar = (email: string, contrasena = CONTRASENA) =>
    request(app.getHttpServer()).post(RUTA).send({ email, contrasena });

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    jwt = app.get(JwtService);
    hashContrasena = await argon2.hash(CONTRASENA);
  });

  // Todas las peticiones salen de la misma IP: cada prueba parte sin contadores
  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
  });

  afterAll(async () => {
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  it('E1-H2 · inicio de sesión correcto: entrega el token con el rol, la cookie de refresco y guarda la sesión', async () => {
    const cuenta = await crearCuenta();

    const respuesta = await iniciar(cuenta.email.toUpperCase())
      .set('User-Agent', 'prueba-e2e')
      .expect(200);

    expect(respuesta.body.usuario).toEqual({
      codigoPublico: cuenta.codigoPublico,
      nombre: 'Camila',
      apellido: 'Rojas',
      rol: ROLES.CLIENTE,
    });
    expect(respuesta.body.expiraEn).toBe(900);
    const carga = await jwt.verifyAsync(respuesta.body.tokenAcceso);
    expect(carga).toMatchObject({
      sub: cuenta.codigoPublico,
      rol: ROLES.CLIENTE,
    });

    const cookie = ([] as string[])
      .concat(respuesta.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('refresco='));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/cuentas\/sesion/);
    expect(JSON.stringify(respuesta.body)).not.toContain(
      cookie!.split(';')[0].split('=')[1],
    );

    const sesiones = await prisma.sesion.findMany({
      where: { usuarioId: cuenta.id },
    });
    expect(sesiones).toHaveLength(1);
    const token = decodeURIComponent(
      cookie!.split(';')[0].slice('refresco='.length),
    );
    expect(sesiones[0].tokenRefrescoHash).toBe(hashearTokenSesion(token));
    expect(sesiones[0].dispositivo).toBe('prueba-e2e');
  });

  it('E1-H2 · credenciales incorrectas: contraseña errónea o correo no registrado → 401 y sin sesión', async () => {
    const cuenta = await crearCuenta();

    const mala = await iniciar(cuenta.email, 'Otra12345').expect(401);
    expect(mala.body.message).toBe('Correo o contraseña incorrectos.');
    expect(mala.headers['set-cookie']).toBeUndefined();

    const inexistente = await iniciar(`nadie-${randomUUID()}@prueba.cl`).expect(
      401,
    );
    expect(inexistente.body.message).toBe(mala.body.message);

    expect(await prisma.sesion.count({ where: { usuarioId: cuenta.id } })).toBe(
      0,
    );
  });

  it('E1-H2 · credenciales incorrectas: datos con formato inválido → 400', async () => {
    await request(app.getHttpServer())
      .post(RUTA)
      .send({ email: 'no-es-correo', contrasena: CONTRASENA })
      .expect(400);
    await request(app.getHttpServer())
      .post(RUTA)
      .send({ email: 'a@b.cl', contrasena: CONTRASENA, rol: 'administrador' })
      .expect(400);
  });

  it('E1-H2 · inicio de sesión correcto: la cuenta sin correo confirmado o desactivada no entra (403)', async () => {
    const sinVerificar = await crearCuenta({ verificada: false });
    const desactivada = await crearCuenta({ activo: false });

    const r1 = await iniciar(sinVerificar.email).expect(403);
    expect(r1.body.message).toBe(
      'Debes confirmar tu correo antes de iniciar sesión.',
    );
    const r2 = await iniciar(desactivada.email).expect(403);
    expect(r2.body.message).toBe('Tu cuenta está desactivada.');

    expect(
      await prisma.sesion.count({
        where: { usuarioId: { in: [sinVerificar.id, desactivada.id] } },
      }),
    ).toBe(0);
  });

  it('E1-H2 · límite de intentos: tras 5 fallidos bloquea incluso la contraseña correcta e indica la espera', async () => {
    const cuenta = await crearCuenta();

    for (let i = 0; i < 5; i++) {
      await iniciar(cuenta.email, 'Otra12345').expect(401);
    }
    const bloqueada = await iniciar(cuenta.email).expect(429);

    expect(bloqueada.body.message).toMatch(
      /^Demasiados intentos fallidos\. Espera 15 minutos/,
    );
    expect(Number(bloqueada.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(bloqueada.headers['retry-after'])).toBeLessThanOrEqual(900);
    expect(await prisma.sesion.count({ where: { usuarioId: cuenta.id } })).toBe(
      0,
    );

    // Otro correo desde la misma IP sigue pudiendo entrar
    const otra = await crearCuenta();
    await iniciar(otra.email).expect(200);
  });

  it('E1-H2 · límite de intentos: 20 intentos simultáneos no evalúan más de 5 contraseñas', async () => {
    const cuenta = await crearCuenta();

    const respuestas = await Promise.all(
      Array.from({ length: 20 }, () => iniciar(cuenta.email, 'Otra12345')),
    );
    const estados = respuestas.map((r) => r.status);

    expect(estados.filter((e) => e === 401)).toHaveLength(5);
    expect(estados.filter((e) => e === 429)).toHaveLength(15);
  });

  it('E1-H2 · límite de intentos: un inicio correcto antes del límite reinicia el contador', async () => {
    const cuenta = await crearCuenta();

    for (let i = 0; i < 4; i++) {
      await iniciar(cuenta.email, 'Otra12345').expect(401);
    }
    await iniciar(cuenta.email).expect(200);
    for (let i = 0; i < 4; i++) {
      await iniciar(cuenta.email, 'Otra12345').expect(401);
    }
    await iniciar(cuenta.email).expect(200);
  });
});
