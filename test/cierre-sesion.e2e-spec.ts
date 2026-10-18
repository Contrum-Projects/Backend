import { INestApplication } from '@nestjs/common';
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

interface Dispositivo {
  tokenAcceso: string;
  /** `refresco=<token>`, tal como el navegador la reenvía. */
  cookie: string;
  tokenRefresco: string;
}

describe('Cuentas · cierre de sesión (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  const correosCreados: string[] = [];

  const crearCuenta = async () => {
    const email = `e2e-cierre-${randomUUID()}@prueba.cl`;
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
      },
    });
    return email;
  };

  /** Inicia sesión como lo haría un dispositivo distinto. */
  const iniciar = async (email: string): Promise<Dispositivo> => {
    const respuesta = await request(app.getHttpServer())
      .post(RUTA)
      .set('User-Agent', `dispositivo-${randomUUID()}`)
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    const cookie = ([] as string[])
      .concat(respuesta.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('refresco='))!
      .split(';')[0];
    return {
      tokenAcceso: (respuesta.body as { tokenAcceso: string }).tokenAcceso,
      cookie,
      tokenRefresco: cookie.slice('refresco='.length),
    };
  };

  const sesionDe = (dispositivo: Dispositivo) =>
    prisma.sesion.findUniqueOrThrow({
      where: {
        tokenRefrescoHash: hashearTokenSesion(dispositivo.tokenRefresco),
      },
    });

  const cerrarTodas = (tokenAcceso?: string) => {
    const peticion = request(app.getHttpServer()).delete(`${RUTA}/todas`);
    return tokenAcceso
      ? peticion.auth(tokenAcceso, { type: 'bearer' })
      : peticion;
  };

  /** La cookie de la respuesta borra la de refresco. */
  const borraCookie = (cabecera: string | string[] | undefined) =>
    ([] as string[])
      .concat(cabecera ?? [])
      .some(
        (c) =>
          c.startsWith('refresco=;') &&
          /Path=\/api\/cuentas\/sesion/.test(c) &&
          /Expires=Thu, 01 Jan 1970/.test(c),
      );

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    hashContrasena = await argon2.hash(CONTRASENA);
  });

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

  it('E1-H3 · cierre en el dispositivo en uso: revoca esa sesión, borra la cookie y su token deja de servir', async () => {
    const email = await crearCuenta();
    const esteDispositivo = await iniciar(email);
    const otroDispositivo = await iniciar(email);

    const respuesta = await request(app.getHttpServer())
      .delete(RUTA)
      .set('Cookie', esteDispositivo.cookie)
      .expect(204);

    expect(borraCookie(respuesta.headers['set-cookie'])).toBe(true);
    expect((await sesionDe(esteDispositivo)).fechaRevocacion).toBeInstanceOf(
      Date,
    );
    // El token de acceso de ese dispositivo ya no sirve, sin esperar a que caduque
    await cerrarTodas(esteDispositivo.tokenAcceso).expect(401);
    // El otro dispositivo sigue con su sesión
    expect((await sesionDe(otroDispositivo)).fechaRevocacion).toBeNull();
  });

  it('E1-H3 · cierre en el dispositivo en uso: con una cookie de refresco plantada antes, igual revoca la real', async () => {
    const dispositivo = await iniciar(await crearCuenta());

    await request(app.getHttpServer())
      .delete(RUTA)
      .set(
        'Cookie',
        `refresco=plantada-por-otro-subdominio; ${dispositivo.cookie}`,
      )
      .expect(204);

    expect((await sesionDe(dispositivo)).fechaRevocacion).toBeInstanceOf(Date);
    await cerrarTodas(dispositivo.tokenAcceso).expect(401);
  });

  it('E1-H3 · cierre en el dispositivo en uso: más de 30 cierres por minuto desde la IP → 429', async () => {
    const respuestas = await Promise.all(
      Array.from({ length: 31 }, () =>
        request(app.getHttpServer()).delete(RUTA),
      ),
    );

    expect(respuestas.filter((r) => r.status === 204)).toHaveLength(30);
    expect(respuestas.filter((r) => r.status === 429)).toHaveLength(1);
  });

  it('E1-H3 · cierre en el dispositivo en uso: sin cookie o con la sesión ya cerrada responde igual', async () => {
    const dispositivo = await iniciar(await crearCuenta());

    await request(app.getHttpServer()).delete(RUTA).expect(204);
    await request(app.getHttpServer())
      .delete(RUTA)
      .set('Cookie', dispositivo.cookie)
      .expect(204);
    const primeraRevocacion = (await sesionDe(dispositivo)).fechaRevocacion;

    await request(app.getHttpServer())
      .delete(RUTA)
      .set('Cookie', dispositivo.cookie)
      .expect(204);
    // La fecha de revocación no cambia
    expect((await sesionDe(dispositivo)).fechaRevocacion).toEqual(
      primeraRevocacion,
    );
  });

  it('E1-H3 · cierre en todos los dispositivos: revoca todas las sesiones y cada dispositivo debe iniciar sesión de nuevo', async () => {
    const email = await crearCuenta();
    const dispositivos = [
      await iniciar(email),
      await iniciar(email),
      await iniciar(email),
    ];
    const otraCuenta = await iniciar(await crearCuenta());

    const respuesta = await cerrarTodas(dispositivos[0].tokenAcceso).expect(
      204,
    );

    expect(borraCookie(respuesta.headers['set-cookie'])).toBe(true);
    for (const dispositivo of dispositivos) {
      expect((await sesionDe(dispositivo)).fechaRevocacion).toBeInstanceOf(
        Date,
      );
      const rechazo = await cerrarTodas(dispositivo.tokenAcceso).expect(401);
      expect((rechazo.body as { message: string }).message).toBe(
        'Tu sesión se cerró. Inicia sesión de nuevo.',
      );
    }
    // Las sesiones de otras cuentas no se tocan
    expect((await sesionDe(otraCuenta)).fechaRevocacion).toBeNull();
    // Iniciar sesión de nuevo funciona
    const nueva = await iniciar(email);
    expect((await sesionDe(nueva)).fechaRevocacion).toBeNull();
  });

  it('E1-H3 · cierre en todos los dispositivos: sin token de acceso válido responde 401', async () => {
    await cerrarTodas().expect(401);
    await cerrarTodas('no-es-un-jwt').expect(401);
  });
});
