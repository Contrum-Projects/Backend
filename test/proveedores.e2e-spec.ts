import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/inventario/proveedores';
// RUT de prueba con dígito verificador válido; se borra al terminar
const RUT = '76086428-5';
const RUT_CON_PUNTOS = '76.086.428-5';

describe('Inventario · proveedores (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  const correosCreados: string[] = [];

  /** Crea una cuenta con ese rol, inicia sesión y devuelve su token de acceso. */
  const tokenDe = async (rol: Rol) => {
    const email = `e2e-proveedores-${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    await prisma.usuario.create({
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
    const respuesta = await request(app.getHttpServer())
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  const registrar = (token: string, cuerpo: object) =>
    request(app.getHttpServer())
      .post(RUTA)
      .auth(token, { type: 'bearer' })
      .send(cuerpo);

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
    await prisma.proveedor.deleteMany({ where: { rut: RUT } });
  });

  afterAll(async () => {
    await prisma.proveedor.deleteMany({ where: { rut: RUT } });
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  it('E11-H1 · RUT nuevo: el bodeguero registra el proveedor y queda disponible en la lista', async () => {
    const token = await tokenDe(ROLES.BODEGUERO);

    const respuesta = await registrar(token, {
      rut: RUT_CON_PUNTOS,
      razonSocial: 'Distribuidora Capilar SpA',
      email: 'Ventas@Distribuidora.cl',
    }).expect(201);

    expect(respuesta.body).toMatchObject({
      rut: RUT,
      razonSocial: 'Distribuidora Capilar SpA',
      email: 'ventas@distribuidora.cl',
      activo: true,
    });
    const lista = await request(app.getHttpServer())
      .get(RUTA)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(
      (lista.body as { rut: string }[]).some(
        (proveedor) => proveedor.rut === RUT,
      ),
    ).toBe(true);
  });

  it('E11-H1 · RUT repetido: rechaza el registro aunque el RUT venga escrito distinto', async () => {
    const token = await tokenDe(ROLES.BODEGUERO);
    await registrar(token, { rut: RUT, razonSocial: 'Primero' }).expect(201);

    await registrar(token, {
      rut: RUT_CON_PUNTOS,
      razonSocial: 'Segundo',
    }).expect(409);

    expect(await prisma.proveedor.count({ where: { rut: RUT } })).toBe(1);
  });

  it('E11-H1 · dos registros simultáneos con el mismo RUT: solo uno se crea', async () => {
    const token = await tokenDe(ROLES.ADMINISTRADOR);

    const respuestas = await Promise.all([
      registrar(token, { rut: RUT, razonSocial: 'A' }),
      registrar(token, { rut: RUT_CON_PUNTOS, razonSocial: 'B' }),
    ]);

    expect(respuestas.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(await prisma.proveedor.count({ where: { rut: RUT } })).toBe(1);
  });

  it('rechaza un RUT inválido y una razón social vacía con 400', async () => {
    const token = await tokenDe(ROLES.BODEGUERO);

    await registrar(token, { rut: '76.086.428-9', razonSocial: 'X' }).expect(
      400,
    );
    await registrar(token, { rut: RUT, razonSocial: '  ' }).expect(400);
    await registrar(token, { rut: RUT }).expect(400);
    expect(await prisma.proveedor.count({ where: { rut: RUT } })).toBe(0);
  });

  it('RNF-03 · sin sesión responde 401 y con rol de comprador 403', async () => {
    await request(app.getHttpServer())
      .post(RUTA)
      .send({ rut: RUT, razonSocial: 'X' })
      .expect(401);
    await request(app.getHttpServer()).get(RUTA).expect(401);

    for (const rol of [ROLES.CLIENTE, ROLES.PROFESIONAL]) {
      const token = await tokenDe(rol);
      await registrar(token, { rut: RUT, razonSocial: 'X' }).expect(403);
      await request(app.getHttpServer())
        .get(RUTA)
        .auth(token, { type: 'bearer' })
        .expect(403);
    }
    expect(await prisma.proveedor.count({ where: { rut: RUT } })).toBe(0);
  });
});
