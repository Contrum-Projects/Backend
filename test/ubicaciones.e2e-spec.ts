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
const RUTA = '/api/inventario/ubicaciones';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-ubicaciones';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '89';
const COMUNA = '89001';

interface UbicacionRespuesta {
  id: number;
  codigo: string;
  bodega: { id: number; nombre: string };
}

describe('Inventario · ubicaciones (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  const correosCreados: string[] = [];

  /** Crea una cuenta con ese rol, inicia sesión y devuelve su token de acceso. */
  const tokenDe = async (rol: Rol) => {
    const email = `e2e-ubicaciones-${randomUUID()}@prueba.cl`;
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

  const limpiar = async () => {
    await prisma.ubicacion.deleteMany({
      where: { bodega: { nombre: { startsWith: PREFIJO } } },
    });
    await prisma.bodega.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
  };

  /** Crea una bodega de prueba en la comuna de prueba. */
  const bodega = async (nombre: string, activa = true) => {
    const comuna = await prisma.comuna.findUniqueOrThrow({
      where: { codigoCut: COMUNA },
    });
    return prisma.bodega.create({
      data: {
        nombre: `${PREFIJO} ${nombre}`,
        direccion: 'Calle de prueba 100',
        tipo: 'bodega',
        comunaId: comuna.id,
        activa,
      },
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
    const region = await prisma.region.upsert({
      where: { codigoCut: REGION },
      update: {},
      create: { codigoCut: REGION, nombre: 'Región de prueba ubicaciones' },
    });
    await prisma.comuna.upsert({
      where: { codigoCut: COMUNA },
      update: {},
      create: {
        codigoCut: COMUNA,
        nombre: 'Comuna de prueba ubicaciones',
        regionId: region.id,
      },
    });
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiar();
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E11 · lista solo las ubicaciones activas de bodegas activas, por bodega y código', async () => {
    const principal = await bodega('A principal');
    const sala = await bodega('B sala');
    const cerrada = await bodega('C cerrada', false);
    const crear = (bodegaId: number, codigo: string, activa = true) =>
      prisma.ubicacion.create({ data: { bodegaId, codigo, activa } });
    const b01 = await crear(principal.id, 'B-01');
    const a01 = await crear(principal.id, 'A-01');
    await crear(principal.id, 'A-02', false);
    const s01 = await crear(sala.id, 'S-01');
    await crear(cerrada.id, 'X-01');

    const vendedor = await tokenDe(ROLES.VENDEDOR);
    const respuesta = await request(app.getHttpServer())
      .get(RUTA)
      .auth(vendedor, { type: 'bearer' })
      .expect(200);

    const propias = (respuesta.body as UbicacionRespuesta[]).filter(
      (ubicacion) => ubicacion.bodega.nombre.startsWith(PREFIJO),
    );
    const enPrincipal = { id: principal.id, nombre: principal.nombre };
    expect(propias).toEqual([
      { id: a01.id, codigo: 'A-01', bodega: enPrincipal },
      { id: b01.id, codigo: 'B-01', bodega: enPrincipal },
      {
        id: s01.id,
        codigo: 'S-01',
        bodega: { id: sala.id, nombre: sala.nombre },
      },
    ]);
  });

  it('E13-H2 · la consulta el personal de inventario: el bodeguero entra y el cliente recibe 403', async () => {
    const bodeguero = await tokenDe(ROLES.BODEGUERO);
    const cliente = await tokenDe(ROLES.CLIENTE);
    await request(app.getHttpServer())
      .get(RUTA)
      .auth(bodeguero, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer())
      .get(RUTA)
      .auth(cliente, { type: 'bearer' })
      .expect(403);
    await request(app.getHttpServer()).get(RUTA).expect(401);
  });
});
