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
const RUTA = '/api/cuentas/yo/facturacion';
// Región y comuna de prueba (códigos que no usa el CUT); se borran al terminar
const REGION = '98';
const COMUNA = '98001';

interface Registro {
  id: number;
  rut: string;
  razonSocial: string;
  giro: string;
  direccion: string;
  correoFacturacion: string | null;
  comuna: { codigoCut: string; nombre: string };
}

const datos = (sufijo = '') => ({
  rut: '76.086.429-3',
  razonSocial: `Peluquería Los Aromos SpA${sufijo}`,
  giro: 'Servicios de peluquería',
  direccion: 'Av. Providencia 1234, oficina 5',
  comuna: COMUNA,
});

describe('Cuentas · datos de facturación (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  const correosCreados: string[] = [];

  /** Crea una cuenta con ese rol, inicia sesión y devuelve su token de acceso. */
  const tokenDe = async (rol: Rol) => {
    const email = `e2e-facturacion-${randomUUID()}@prueba.cl`;
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
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  const guardar = async (token: string, cuerpo: object = datos()) => {
    const respuesta = await request(app.getHttpServer())
      .post(RUTA)
      .auth(token, { type: 'bearer' })
      .send(cuerpo)
      .expect(201);
    return respuesta.body as Registro;
  };

  const listar = async (token: string) => {
    const respuesta = await request(app.getHttpServer())
      .get(RUTA)
      .auth(token, { type: 'bearer' })
      .expect(200);
    return respuesta.body as Registro[];
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
    // Los datos de facturación no se borran en cascada con la cuenta
    await prisma.datosFacturacion.deleteMany({
      where: { usuario: { email: { in: correosCreados } } },
    });
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E9-H2 · datos guardados: se agregan a la cuenta y quedan en su lista', async () => {
    const token = await tokenDe(ROLES.CLIENTE);

    const respuesta = await request(app.getHttpServer())
      .post(RUTA)
      .auth(token, { type: 'bearer' })
      .send({ ...datos(), correoFacturacion: 'Facturas@LosAromos.cl' })
      .expect(201);

    expect(respuesta.body).toMatchObject({
      rut: '76086429-3',
      razonSocial: 'Peluquería Los Aromos SpA',
      giro: 'Servicios de peluquería',
      direccion: 'Av. Providencia 1234, oficina 5',
      correoFacturacion: 'facturas@losaromos.cl',
      comuna: { codigoCut: COMUNA, region: { codigoCut: REGION } },
    });
    expect(await listar(token)).toEqual([
      expect.objectContaining({ id: (respuesta.body as Registro).id }),
    ]);
  });

  it('E9-H2 · varios registros: la consulta devuelve todos los de la cuenta y solo los suyos', async () => {
    const token = await tokenDe(ROLES.PROFESIONAL);
    const primero = await guardar(token, datos(' 1'));
    const segundo = await guardar(token, datos(' 2'));
    await guardar(await tokenDe(ROLES.CLIENTE), datos(' ajeno'));

    const lista = await listar(token);

    expect(lista.map((registro) => registro.id)).toEqual([
      primero.id,
      segundo.id,
    ]);
    expect(lista[1].correoFacturacion).toBeNull();
  });

  it('E9-H2 · datos incompletos: no guarda nada e indica lo que falta', async () => {
    const token = await tokenDe(ROLES.CLIENTE);
    const { giro: _giro, razonSocial: _razon, ...incompleto } = datos();

    const respuesta = await request(app.getHttpServer())
      .post(RUTA)
      .auth(token, { type: 'bearer' })
      .send(incompleto)
      .expect(400);

    expect((respuesta.body as { message: string[] }).message).toEqual(
      expect.arrayContaining([
        'La razón social es obligatoria.',
        'El giro es obligatorio.',
      ]),
    );
    expect(await listar(token)).toEqual([]);
  });

  it('un RUT inválido o una comuna que no existe responde 400 y no guarda', async () => {
    const token = await tokenDe(ROLES.CLIENTE);

    const rut = await request(app.getHttpServer())
      .post(RUTA)
      .auth(token, { type: 'bearer' })
      .send({ ...datos(), rut: '76086429-4' })
      .expect(400);
    expect((rut.body as { message: string[] }).message).toContain(
      'El RUT no es válido.',
    );

    const comuna = await request(app.getHttpServer())
      .post(RUTA)
      .auth(token, { type: 'bearer' })
      .send({ ...datos(), comuna: '98999' })
      .expect(400);
    expect((comuna.body as { message: string }).message).toBe(
      'La comuna no existe.',
    );

    expect(await listar(token)).toEqual([]);
  });

  it('editar cambia solo lo enviado y null borra el correo de facturación', async () => {
    const token = await tokenDe(ROLES.CLIENTE);
    const registro = await request(app.getHttpServer())
      .post(RUTA)
      .auth(token, { type: 'bearer' })
      .send({ ...datos(), correoFacturacion: 'facturas@losaromos.cl' })
      .expect(201);
    const { id } = registro.body as Registro;

    const editado = await request(app.getHttpServer())
      .patch(`${RUTA}/${id}`)
      .auth(token, { type: 'bearer' })
      .send({ giro: 'Comercio al por menor', correoFacturacion: null })
      .expect(200);

    expect(editado.body).toMatchObject({
      id,
      giro: 'Comercio al por menor',
      razonSocial: 'Peluquería Los Aromos SpA',
      correoFacturacion: null,
    });

    await request(app.getHttpServer())
      .patch(`${RUTA}/${id}`)
      .auth(token, { type: 'bearer' })
      .send({ giro: ' ' })
      .expect(400);
  });

  it('eliminar quita el registro de la lista pero lo conserva desactivado para los pedidos', async () => {
    const token = await tokenDe(ROLES.CLIENTE);
    const quitado = await guardar(token, datos(' quitado'));
    const quedan = await guardar(token, datos(' queda'));

    await request(app.getHttpServer())
      .delete(`${RUTA}/${quitado.id}`)
      .auth(token, { type: 'bearer' })
      .expect(204);

    expect((await listar(token)).map((registro) => registro.id)).toEqual([
      quedan.id,
    ]);
    expect(
      await prisma.datosFacturacion.findUnique({ where: { id: quitado.id } }),
    ).toMatchObject({ activo: false });

    for (const peticion of [
      () => request(app.getHttpServer()).patch(`${RUTA}/${quitado.id}`),
      () => request(app.getHttpServer()).delete(`${RUTA}/${quitado.id}`),
    ]) {
      await peticion()
        .auth(token, { type: 'bearer' })
        .send({ giro: 'Otro' })
        .expect(404);
    }
  });

  it('los datos de otra cuenta responden 404 y no cambian', async () => {
    const duena = await tokenDe(ROLES.CLIENTE);
    const ajeno = await guardar(duena, datos(' ajeno'));
    const otra = await tokenDe(ROLES.CLIENTE);

    // Cada petición se crea al enviarla: supertest cierra el servidor al terminar la anterior
    const servidor = () => request(app.getHttpServer());
    for (const peticion of [
      () => servidor().patch(`${RUTA}/${ajeno.id}`),
      () => servidor().delete(`${RUTA}/${ajeno.id}`),
    ]) {
      await peticion()
        .auth(otra, { type: 'bearer' })
        .send({ giro: 'Cambiado' })
        .expect(404);
    }

    expect(
      await prisma.datosFacturacion.findUnique({ where: { id: ajeno.id } }),
    ).toMatchObject({ giro: 'Servicios de peluquería', activo: true });
  });

  it('sin sesión responde 401 y el personal de tienda 403 en todas las rutas', async () => {
    const servidor = () => request(app.getHttpServer());
    // Cada petición se crea al enviarla: supertest cierra el servidor al terminar la anterior
    const peticiones = [
      () => servidor().get(RUTA),
      () => servidor().post(RUTA),
      () => servidor().patch(`${RUTA}/1`),
      () => servidor().delete(`${RUTA}/1`),
    ];

    for (const peticion of peticiones) await peticion().expect(401);

    const vendedor = await tokenDe(ROLES.VENDEDOR);
    for (const peticion of peticiones) {
      await peticion().auth(vendedor, { type: 'bearer' }).expect(403);
    }
  });
});
