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
  ESPECIALIDADES,
  MODALIDADES_TRABAJO,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/perfil-profesional/yo';

interface Perfil {
  anosExperiencia: number;
  modalidad: string;
  especialidades: string[];
  nombreLugarTrabajo: string | null;
  redSocial: string | null;
  fechaActualizacion: string;
}

const perfil = () => ({
  anosExperiencia: 8,
  modalidad: MODALIDADES_TRABAJO.ARRIENDO_SILLON,
  especialidades: [ESPECIALIDADES.COLORACION_TINTURAS, ESPECIALIDADES.ALISADOS],
});

describe('Verificación · perfil profesional (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  const correosCreados: string[] = [];

  /** Crea una cuenta con ese rol, inicia sesión y devuelve su correo y token de acceso. */
  const cuentaCon = async (rol: Rol) => {
    const email = `e2e-perfil-${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
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
    return {
      email,
      token: (respuesta.body as { tokenAcceso: string }).tokenAcceso,
    };
  };

  const perfilEnBase = (email: string) =>
    prisma.perfilProfesional.findFirst({ where: { usuario: { email } } });

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
  });

  afterAll(async () => {
    // El perfil se borra en cascada con la cuenta
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  it('E10-H5 · perfil guardado: sin lugar de trabajo, lo crea y se puede consultar', async () => {
    const { email, token } = await cuentaCon(ROLES.PROFESIONAL);

    const respuesta = await request(app.getHttpServer())
      .put(RUTA)
      .auth(token, { type: 'bearer' })
      .send(perfil())
      .expect(200);

    expect(respuesta.body).toMatchObject({
      ...perfil(),
      nombreLugarTrabajo: null,
      redSocial: null,
    });
    expect(await perfilEnBase(email)).toMatchObject(perfil());

    const consulta = await request(app.getHttpServer())
      .get(RUTA)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(consulta.body).toEqual(respuesta.body);
  });

  it('E10-H5 · perfil guardado: guardarlo de nuevo reemplaza el anterior, con lugar de trabajo y red social', async () => {
    const { email, token } = await cuentaCon(ROLES.PROFESIONAL);
    await request(app.getHttpServer())
      .put(RUTA)
      .auth(token, { type: 'bearer' })
      .send({ ...perfil(), nombreLugarTrabajo: 'Salón Bella Vista' })
      .expect(200);

    const respuesta = await request(app.getHttpServer())
      .put(RUTA)
      .auth(token, { type: 'bearer' })
      .send({
        anosExperiencia: 9,
        modalidad: MODALIDADES_TRABAJO.SALON_PROPIO,
        especialidades: [ESPECIALIDADES.CORTE_DAMA],
        redSocial: '@bellavista.salon',
      })
      .expect(200);

    expect(respuesta.body as Perfil).toMatchObject({
      anosExperiencia: 9,
      modalidad: MODALIDADES_TRABAJO.SALON_PROPIO,
      especialidades: [ESPECIALIDADES.CORTE_DAMA],
      nombreLugarTrabajo: null,
      redSocial: '@bellavista.salon',
    });
    expect(
      await prisma.perfilProfesional.count({
        where: { usuario: { email } },
      }),
    ).toBe(1);
  });

  it('E10-H5 · datos obligatorios faltantes: 400 que indica lo que falta y no guarda el perfil', async () => {
    const { email, token } = await cuentaCon(ROLES.PROFESIONAL);

    const respuesta = await request(app.getHttpServer())
      .put(RUTA)
      .auth(token, { type: 'bearer' })
      .send({ nombreLugarTrabajo: 'Salón Bella Vista' })
      .expect(400);

    const { message } = respuesta.body as { message: string[] };
    expect(message).toHaveLength(3);
    expect(message[0]).toBe(
      'La cantidad de años de experiencia es obligatoria.',
    );
    expect(message[1]).toMatch(/^La modalidad de trabajo es obligatoria/);
    expect(message[2]).toBe('Indica al menos una especialidad.');
    expect(await perfilEnBase(email)).toBeNull();
  });

  it('E10-H5 · datos obligatorios faltantes: una lista de especialidades vacía no guarda el perfil', async () => {
    const { email, token } = await cuentaCon(ROLES.PROFESIONAL);

    const respuesta = await request(app.getHttpServer())
      .put(RUTA)
      .auth(token, { type: 'bearer' })
      .send({ ...perfil(), especialidades: [] })
      .expect(400);

    expect((respuesta.body as { message: string[] }).message).toEqual([
      'Indica al menos una especialidad.',
    ]);
    expect(await perfilEnBase(email)).toBeNull();
  });

  it('E10-H5 · cuenta sin verificar: el cliente recibe 403 al guardar y al consultar', async () => {
    const { email, token } = await cuentaCon(ROLES.CLIENTE);

    await request(app.getHttpServer())
      .put(RUTA)
      .auth(token, { type: 'bearer' })
      .send(perfil())
      .expect(403);
    await request(app.getHttpServer())
      .get(RUTA)
      .auth(token, { type: 'bearer' })
      .expect(403);
    expect(await perfilEnBase(email)).toBeNull();
  });

  it('el personal de tienda recibe 403 y sin sesión responde 401', async () => {
    const { token } = await cuentaCon(ROLES.ADMINISTRADOR);

    await request(app.getHttpServer())
      .put(RUTA)
      .auth(token, { type: 'bearer' })
      .send(perfil())
      .expect(403);
    await request(app.getHttpServer()).put(RUTA).send(perfil()).expect(401);
    await request(app.getHttpServer()).get(RUTA).expect(401);
  });

  it('consultar sin haberlo completado responde 404', async () => {
    const { token } = await cuentaCon(ROLES.PROFESIONAL);

    const respuesta = await request(app.getHttpServer())
      .get(RUTA)
      .auth(token, { type: 'bearer' })
      .expect(404);
    expect((respuesta.body as { message: string }).message).toBe(
      'Aún no completas tu perfil profesional.',
    );
  });
});
