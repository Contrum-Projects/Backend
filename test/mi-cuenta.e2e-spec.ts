import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import { ESTADOS_SOLICITUD } from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA_DATOS = '/api/cuentas/yo';
const RUTA_DIRECCIONES = '/api/cuentas/yo/direcciones';
// Región y comuna de prueba (códigos que no usa el CUT); se borran al terminar
const REGION = '99';
const COMUNA = '99001';
// RUT de prueba con dígito verificador válido; se borran al terminar
const RUT_PROPIO = '76086429-3';
const RUT_AJENO = '10000013-K';

interface Direccion {
  id: number;
  esPrincipal: boolean;
}

describe('Cuentas · datos personales y direcciones (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  const correosCreados: string[] = [];

  /** Crea una cuenta con ese rol, inicia sesión y devuelve su token de acceso. */
  const tokenDe = async (rol: Rol, rut?: string) => {
    const email = `e2e-mi-cuenta-${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Prueba',
        apellido: 'E2E',
        email,
        contrasenaHash: hashContrasena,
        rol,
        rut,
        fechaVerificacionCorreo: new Date(),
      },
    });
    const respuesta = await request(app.getHttpServer())
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  const crearDireccion = async (token: string, calle: string) => {
    const respuesta = await request(app.getHttpServer())
      .post(RUTA_DIRECCIONES)
      .auth(token, { type: 'bearer' })
      .send({ calle, numero: '100', comuna: COMUNA })
      .expect(201);
    return respuesta.body as Direccion;
  };

  const listarDirecciones = async (token: string) => {
    const respuesta = await request(app.getHttpServer())
      .get(RUTA_DIRECCIONES)
      .auth(token, { type: 'bearer' })
      .expect(200);
    return respuesta.body as Direccion[];
  };

  const limpiarRuts = () =>
    prisma.usuario.deleteMany({
      where: { rut: { in: [RUT_PROPIO, RUT_AJENO] } },
    });

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    hashContrasena = await argon2.hash(CONTRASENA);

    await limpiarRuts();
    const region = await prisma.region.upsert({
      where: { codigoCut: REGION },
      update: {},
      create: { codigoCut: REGION, nombre: 'Región de prueba' },
    });
    await prisma.comuna.upsert({
      where: { codigoCut: COMUNA },
      update: {},
      create: {
        codigoCut: COMUNA,
        nombre: 'Comuna de prueba',
        regionId: region.id,
      },
    });
  });

  // Todas las peticiones salen de la misma IP: cada prueba parte sin contadores
  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
  });

  afterAll(async () => {
    // Las direcciones se borran en cascada con la cuenta; las solicitudes no
    await prisma.solicitudVerificacion.deleteMany({
      where: { solicitante: { email: { in: correosCreados } } },
    });
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E1-H5 · actualización de datos: guarda los cambios y los muestra en la cuenta', async () => {
    const token = await tokenDe(ROLES.CLIENTE);

    const respuesta = await request(app.getHttpServer())
      .patch(RUTA_DATOS)
      .auth(token, { type: 'bearer' })
      .send({
        nombre: 'Camila',
        telefono: '+56912345678',
        rut: '76.086.429-3',
        fechaNacimiento: '1990-05-21',
      })
      .expect(200);
    expect(respuesta.body).toMatchObject({
      nombre: 'Camila',
      apellido: 'E2E',
      telefono: '+56912345678',
      rut: RUT_PROPIO,
      fechaNacimiento: '1990-05-21',
    });

    const cuenta = await request(app.getHttpServer())
      .get(RUTA_DATOS)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(cuenta.body).toEqual(respuesta.body);
    expect(cuenta.body).not.toHaveProperty('id');
    expect(cuenta.body).not.toHaveProperty('contrasenaHash');
  });

  it('E1-H5 · RUT de otra cuenta: rechaza el cambio e informa que el RUT ya está en uso', async () => {
    await tokenDe(ROLES.CLIENTE, RUT_AJENO);
    const token = await tokenDe(ROLES.CLIENTE);

    const respuesta = await request(app.getHttpServer())
      .patch(RUTA_DATOS)
      .auth(token, { type: 'bearer' })
      .send({ nombre: 'Otro nombre', rut: '10.000.013-k' })
      .expect(409);
    expect((respuesta.body as { message: string }).message).toMatch(
      /RUT ya está en uso/,
    );

    // No guarda nada del cambio rechazado
    const cuenta = await request(app.getHttpServer())
      .get(RUTA_DATOS)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(cuenta.body).toMatchObject({ nombre: 'Prueba', rut: null });
  });

  it('el correo no se edita y el profesional no cambia su RUT', async () => {
    const cliente = await tokenDe(ROLES.CLIENTE);
    await request(app.getHttpServer())
      .patch(RUTA_DATOS)
      .auth(cliente, { type: 'bearer' })
      .send({ email: 'otro@prueba.cl' })
      .expect(400);

    await prisma.usuario.deleteMany({ where: { rut: RUT_PROPIO } });
    const profesional = await tokenDe(ROLES.PROFESIONAL, RUT_PROPIO);
    await request(app.getHttpServer())
      .patch(RUTA_DATOS)
      .auth(profesional, { type: 'bearer' })
      .send({ rut: null })
      .expect(403);
    expect(await prisma.usuario.count({ where: { rut: RUT_PROPIO } })).toBe(1);
  });

  it('con una verificación profesional en curso el RUT no cambia (403)', async () => {
    const token = await tokenDe(ROLES.CLIENTE);
    const cuenta = await request(app.getHttpServer())
      .get(RUTA_DATOS)
      .auth(token, { type: 'bearer' })
      .expect(200);
    const { id } = await prisma.usuario.findUniqueOrThrow({
      where: {
        codigoPublico: (cuenta.body as { codigoPublico: string }).codigoPublico,
      },
      select: { id: true },
    });
    await prisma.solicitudVerificacion.create({
      data: { solicitanteId: id, estado: ESTADOS_SOLICITUD.PENDIENTE },
    });

    await request(app.getHttpServer())
      .patch(RUTA_DATOS)
      .auth(token, { type: 'bearer' })
      .send({ rut: RUT_PROPIO })
      .expect(403);

    // Los demás datos sí se pueden editar
    await request(app.getHttpServer())
      .patch(RUTA_DATOS)
      .auth(token, { type: 'bearer' })
      .send({ nombre: 'Sigue editando' })
      .expect(200);
    await prisma.solicitudVerificacion.deleteMany({
      where: { solicitanteId: id },
    });
  });

  it('límite: más de 10 ediciones por hora en la misma cuenta responden 429; otra cuenta no se ve afectada', async () => {
    const token = await tokenDe(ROLES.CLIENTE);
    const editar = (t: string) =>
      request(app.getHttpServer())
        .patch(RUTA_DATOS)
        .auth(t, { type: 'bearer' })
        .send({ nombre: 'Camila' });

    for (let i = 0; i < 10; i++) await editar(token).expect(200);
    await editar(token).expect(429);

    const otra = await tokenDe(ROLES.CLIENTE);
    await editar(otra).expect(200);
  });

  it('E1-H5 · dirección principal: al marcar otra, queda como la única principal', async () => {
    const token = await tokenDe(ROLES.CLIENTE);
    const primera = await crearDireccion(token, 'Primera');
    const segunda = await crearDireccion(token, 'Segunda');
    expect(primera.esPrincipal).toBe(true);
    expect(segunda.esPrincipal).toBe(false);

    await request(app.getHttpServer())
      .patch(`${RUTA_DIRECCIONES}/${segunda.id}/principal`)
      .auth(token, { type: 'bearer' })
      .expect(200);

    const direcciones = await listarDirecciones(token);
    expect(direcciones.filter((d) => d.esPrincipal)).toEqual([
      expect.objectContaining({ id: segunda.id }),
    ]);
    expect(direcciones[0].id).toBe(segunda.id);
  });

  it('E1-H5 · dirección principal: marcar dos a la vez deja una sola principal', async () => {
    const token = await tokenDe(ROLES.CLIENTE);
    await crearDireccion(token, 'Primera');
    const segunda = await crearDireccion(token, 'Segunda');
    const tercera = await crearDireccion(token, 'Tercera');

    await Promise.all(
      [segunda, tercera].map((d) =>
        request(app.getHttpServer())
          .patch(`${RUTA_DIRECCIONES}/${d.id}/principal`)
          .auth(token, { type: 'bearer' })
          .expect(200),
      ),
    );

    const direcciones = await listarDirecciones(token);
    expect(direcciones.filter((d) => d.esPrincipal)).toHaveLength(1);
  });

  it('editar y eliminar: al borrar la principal pasa a serlo la más reciente', async () => {
    const token = await tokenDe(ROLES.CLIENTE);
    const primera = await crearDireccion(token, 'Primera');
    await crearDireccion(token, 'Segunda');
    const tercera = await crearDireccion(token, 'Tercera');

    const editada = await request(app.getHttpServer())
      .patch(`${RUTA_DIRECCIONES}/${tercera.id}`)
      .auth(token, { type: 'bearer' })
      .send({ calle: 'Los Leones', referencia: 'Depto. 501' })
      .expect(200);
    expect(editada.body).toMatchObject({
      calle: 'Los Leones',
      referencia: 'Depto. 501',
      comuna: { codigoCut: COMUNA, region: { codigoCut: REGION } },
    });

    await request(app.getHttpServer())
      .delete(`${RUTA_DIRECCIONES}/${primera.id}`)
      .auth(token, { type: 'bearer' })
      .expect(204);

    const direcciones = await listarDirecciones(token);
    expect(direcciones).toHaveLength(2);
    expect(direcciones.filter((d) => d.esPrincipal)).toEqual([
      expect.objectContaining({ id: tercera.id }),
    ]);
  });

  it('la dirección de otra cuenta responde 404 y no cambia', async () => {
    const duena = await tokenDe(ROLES.CLIENTE);
    const ajena = await crearDireccion(duena, 'Ajena');
    const otra = await tokenDe(ROLES.CLIENTE);

    // Cada petición se crea al enviarla: supertest cierra el servidor al terminar la anterior
    const servidor = () => request(app.getHttpServer());
    for (const peticion of [
      () => servidor().patch(`${RUTA_DIRECCIONES}/${ajena.id}`),
      () => servidor().patch(`${RUTA_DIRECCIONES}/${ajena.id}/principal`),
      () => servidor().delete(`${RUTA_DIRECCIONES}/${ajena.id}`),
    ]) {
      await peticion()
        .auth(otra, { type: 'bearer' })
        .send({ calle: 'Cambiada' })
        .expect(404);
    }

    const direccion = await prisma.direccion.findUnique({
      where: { id: ajena.id },
    });
    expect(direccion).toMatchObject({ calle: 'Ajena', esPrincipal: true });
  });

  it('sin sesión responde 401 y el personal de tienda 403 en todas las rutas', async () => {
    const servidor = () => request(app.getHttpServer());
    // Cada petición se crea al enviarla: supertest cierra el servidor al terminar la anterior
    const peticiones = [
      () => servidor().get(RUTA_DATOS),
      () => servidor().patch(RUTA_DATOS),
      () => servidor().get(RUTA_DIRECCIONES),
      () => servidor().post(RUTA_DIRECCIONES),
      () => servidor().patch(`${RUTA_DIRECCIONES}/1`),
      () => servidor().patch(`${RUTA_DIRECCIONES}/1/principal`),
      () => servidor().delete(`${RUTA_DIRECCIONES}/1`),
    ];

    for (const peticion of peticiones) await peticion().expect(401);

    const vendedor = await tokenDe(ROLES.VENDEDOR);
    for (const peticion of peticiones) {
      await peticion().auth(vendedor, { type: 'bearer' }).expect(403);
    }
  });
});
