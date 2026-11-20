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
import { ConsultaRegistroErroresService } from '../src/modulos/registro-errores/consulta-registro-errores.service.js';
import type { ListadoRegistroErroresDto } from '../src/modulos/registro-errores/dto/registro-error-respuesta.dto.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const PREFIJO_CORREO = 'e2e-registro-errores-';
const DIA_MS = 24 * 60 * 60 * 1000;

describe('Registro de errores · panel y limpieza (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  /** Marca de esta corrida en el componente, para no mezclarse con otros registros. */
  const marca = `e2e-${randomUUID().slice(0, 8)}`;

  const servidor = () => request(app.getHttpServer());

  const tokenDe = async (rol: Rol) => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Andrea',
        apellido: 'Soto',
        email,
        contrasenaHash: hashContrasena,
        rol,
        fechaVerificacionCorreo: new Date(),
      },
    });
    const respuesta = await servidor()
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  const registrar = (
    codigoSeguimiento: string,
    origen: string,
    fechaHora: Date,
  ) =>
    prisma.registroError.create({
      data: {
        codigoSeguimiento,
        origen,
        fechaHora,
        componente: `${marca} PedidosService.crear`,
        tipoError: 'TypeError',
        mensaje: 'falló',
      },
    });

  const limpiar = async () => {
    await prisma.registroError.deleteMany({
      where: { componente: { startsWith: marca } },
    });
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
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  it('SCRUM-168 · solo el administrador consulta el registro: sin sesión 401; vendedor o bodeguero 403', async () => {
    await servidor().get('/api/registros/errores').expect(401);
    for (const rol of [ROLES.VENDEDOR, ROLES.BODEGUERO, ROLES.CLIENTE]) {
      const token = await tokenDe(rol);
      await servidor()
        .get('/api/registros/errores')
        .auth(token, { type: 'bearer' })
        .expect(403);
    }
  });

  it('SCRUM-168 · el administrador busca por código, filtra por origen y fechas, y ve los conteos', async () => {
    const admin = await tokenDe(ROLES.ADMINISTRADOR);
    const ahora = new Date();
    const codigoApi = `${marca}-api-1`;
    await registrar(codigoApi, 'api', ahora);
    await registrar(`${marca}-nav-1`, 'navegador', ahora);
    await registrar(
      `${marca}-viejo`,
      'api',
      new Date(ahora.getTime() - 10 * DIA_MS),
    );

    const listar = async (consulta: string) =>
      (
        await servidor()
          .get(`/api/registros/errores?${consulta}`)
          .auth(admin, { type: 'bearer' })
          .expect(200)
      ).body as ListadoRegistroErroresDto;

    const todos = await listar(`buscar=${marca}`);
    expect(todos.total).toBe(3);
    expect(todos.conteos).toEqual({
      todos: 3,
      api: 2,
      navegador: 1,
      servidorWeb: 0,
    });
    expect(todos.diasRetencion).toBe(90);

    const deApi = await listar(`buscar=${marca}&origen=api`);
    expect(deApi.items.map((item) => item.codigoSeguimiento)).toEqual([
      codigoApi,
      `${marca}-viejo`,
    ]);

    // Por el comienzo del código, sin distinguir mayúsculas (lo que ve la persona)
    const porCodigo = await listar(`buscar=${codigoApi.toUpperCase()}`);
    expect(porCodigo.items).toHaveLength(1);

    const hoy = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
    }).format(ahora);
    const deHoy = await listar(`buscar=${marca}&desde=${hoy}&hasta=${hoy}`);
    expect(deHoy.total).toBe(2);
  });

  it('SCRUM-168 · fechas al revés: 400 en el campo hasta', async () => {
    const admin = await tokenDe(ROLES.ADMINISTRADOR);
    const respuesta = await servidor()
      .get('/api/registros/errores?desde=2026-11-20&hasta=2026-11-01')
      .auth(admin, { type: 'bearer' })
      .expect(400);
    expect(respuesta.body).toMatchObject({
      errores: [{ campo: 'hasta' }],
    });
  });

  it('SCRUM-168 · la limpieza borra los errores con más de 90 días y deja los recientes', async () => {
    const ahora = new Date();
    await registrar(
      `${marca}-91-dias`,
      'api',
      new Date(ahora.getTime() - 91 * DIA_MS),
    );
    await registrar(
      `${marca}-89-dias`,
      'api',
      new Date(ahora.getTime() - 89 * DIA_MS),
    );

    await app.get(ConsultaRegistroErroresService).eliminarAntiguos(ahora);

    const quedan = await prisma.registroError.findMany({
      where: {
        codigoSeguimiento: { in: [`${marca}-91-dias`, `${marca}-89-dias`] },
      },
      select: { codigoSeguimiento: true },
    });
    expect(quedan).toEqual([{ codigoSeguimiento: `${marca}-89-dias` }]);
  });
});
