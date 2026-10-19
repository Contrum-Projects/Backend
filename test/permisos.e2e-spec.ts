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
const RUTA_PERSONAL = '/api/personal';
const RUTA_PROVEEDORES = '/api/inventario/proveedores';
// RUT de prueba con dígito verificador válido; se borra al terminar
const RUT = '76086429-3';

describe('Personal · permisos por rol en el panel (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  const correosCreados: string[] = [];

  const nuevoCorreo = () => {
    const email = `e2e-permisos-${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    return email;
  };

  /** Crea una cuenta con ese rol, inicia sesión y devuelve su token de acceso. */
  const tokenDe = async (rol: Rol) => {
    const email = nuevoCorreo();
    await prisma.usuario.create({
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
    const respuesta = await request(app.getHttpServer())
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  const registrarProveedor = (token: string) =>
    request(app.getHttpServer())
      .post(RUTA_PROVEEDORES)
      .auth(token, { type: 'bearer' })
      .send({ rut: RUT, razonSocial: 'Distribuidora Capilar SpA' });

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

  // Todas las peticiones salen de la misma IP: cada prueba parte sin contadores
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

  it('E13-H2 · acción permitida: el rol con el permiso realiza la acción', async () => {
    const bodeguero = await tokenDe(ROLES.BODEGUERO);
    await registrarProveedor(bodeguero).expect(201);
    expect(await prisma.proveedor.count({ where: { rut: RUT } })).toBe(1);

    const administrador = await tokenDe(ROLES.ADMINISTRADOR);
    await request(app.getHttpServer())
      .get(RUTA_PERSONAL)
      .auth(administrador, { type: 'bearer' })
      .expect(200);
  });

  it('E13-H2 · acción sin permiso: la API directa responde 403 y no modifica ningún dato', async () => {
    const vendedor = await tokenDe(ROLES.VENDEDOR);
    await registrarProveedor(vendedor).expect(403);
    expect(await prisma.proveedor.count({ where: { rut: RUT } })).toBe(0);

    const bodeguero = await tokenDe(ROLES.BODEGUERO);
    const email = nuevoCorreo();
    await request(app.getHttpServer())
      .post(RUTA_PERSONAL)
      .auth(bodeguero, { type: 'bearer' })
      .send({
        nombre: 'Javiera',
        apellido: 'Muñoz',
        email,
        rol: ROLES.BODEGUERO,
      })
      .expect(403);
    expect(await prisma.usuario.count({ where: { email } })).toBe(0);
  });

  it('E13-H2 · cliente en el panel: cliente y profesional reciben 403 en las rutas del panel', async () => {
    for (const rol of [ROLES.CLIENTE, ROLES.PROFESIONAL]) {
      const token = await tokenDe(rol);
      for (const ruta of [RUTA_PERSONAL, RUTA_PROVEEDORES]) {
        await request(app.getHttpServer())
          .get(ruta)
          .auth(token, { type: 'bearer' })
          .expect(403);
      }
      await registrarProveedor(token).expect(403);
    }
    expect(await prisma.proveedor.count({ where: { rut: RUT } })).toBe(0);
  });
});
