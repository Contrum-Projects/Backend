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
// Las solicitudes se crean directo en la base en `revision_manual`: cómo llegan ahí es de E10-H1 y
// E10-H2, que tienen sus propias pruebas.

const CONTRASENA = 'Secreta123';
const PREFIJO_CORREO = 'e2e-revision-verificacion-';
const MOTIVO = 'El certificado adjunto no es legible.';

describe('Verificación · aprobar o rechazar solicitudes en revisión manual (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  const correosCreados: string[] = [];

  const servidor = () => request(app.getHttpServer());

  const cuenta = async (rol: Rol = ROLES.CLIENTE) => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    const usuario = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Marcela',
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
    return {
      id: usuario.id,
      codigoPublico: usuario.codigoPublico,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      token: (respuesta.body as { tokenAcceso: string }).tokenAcceso,
    };
  };

  /** Una cuenta cliente con su solicitud en `revision_manual` (o el estado indicado). */
  const solicitante = async (
    estado: string = ESTADOS_SOLICITUD.REVISION_MANUAL,
  ) => {
    const cliente = await cuenta();
    const solicitud = await prisma.solicitudVerificacion.create({
      data: {
        solicitanteId: cliente.id,
        estado,
        resultadoConsultaSii: 'otro_giro',
      },
    });
    return { ...cliente, solicitudId: solicitud.id };
  };

  const aprobar = (token: string | null, codigo: string) => {
    const peticion = servidor().post(`/api/verificaciones/${codigo}/aprobar`);
    return token ? peticion.auth(token, { type: 'bearer' }) : peticion;
  };

  const rechazar = (token: string | null, codigo: string, cuerpo: object) => {
    const peticion = servidor()
      .post(`/api/verificaciones/${codigo}/rechazar`)
      .send(cuerpo);
    return token ? peticion.auth(token, { type: 'bearer' }) : peticion;
  };

  const solicitud = (id: number) =>
    prisma.solicitudVerificacion.findUniqueOrThrow({ where: { id } });

  const limpiar = async () => {
    await prisma.solicitudVerificacion.deleteMany({
      where: { solicitante: { email: { startsWith: PREFIJO_CORREO } } },
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
    await app.close();
  });

  it('E10-H3 · aprobación manual: la deja aprobada y registra quién la resolvió y cuándo', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    const cliente = await solicitante();
    const antes = Date.now();

    const respuesta = await aprobar(
      administrador.token,
      cliente.codigoPublico,
    ).expect(200);

    const guardada = await solicitud(cliente.solicitudId);
    expect(guardada.estado).toBe('aprobada');
    expect(guardada.resolutorId).toBe(administrador.id);
    expect(guardada.fechaResolucion?.getTime()).toBeGreaterThanOrEqual(
      antes - 1000,
    );
    expect(guardada.motivoRechazo).toBeNull();
    expect(respuesta.body).toEqual({
      codigoPublicoCuenta: cliente.codigoPublico,
      estado: 'aprobada',
      fechaSolicitud: guardada.fechaSolicitud.toISOString(),
      fechaResolucion: guardada.fechaResolucion?.toISOString(),
      motivoRechazo: null,
      resolutor: {
        codigoPublico: administrador.codigoPublico,
        nombre: administrador.nombre,
        apellido: administrador.apellido,
      },
    });
  });

  it('E10-H3 · rechazo con motivo: la deja rechazada, guarda el motivo recortado y quien solicitó lo ve', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    const cliente = await solicitante();

    const respuesta = await rechazar(
      administrador.token,
      cliente.codigoPublico,
      { motivo: `  ${MOTIVO}  ` },
    ).expect(200);

    const guardada = await solicitud(cliente.solicitudId);
    expect(guardada).toMatchObject({
      estado: 'rechazada',
      motivoRechazo: MOTIVO,
      resolutorId: administrador.id,
    });
    expect(guardada.fechaResolucion).not.toBeNull();
    expect(respuesta.body).toMatchObject({
      estado: 'rechazada',
      motivoRechazo: MOTIVO,
    });

    const mia = await servidor()
      .get('/api/verificaciones/yo')
      .auth(cliente.token, { type: 'bearer' })
      .expect(200);
    expect(mia.body).toMatchObject({
      estado: 'rechazada',
      motivoRechazo: MOTIVO,
    });
  });

  it('E10-H3 · rechazo sin motivo: 400 que indica que el motivo es obligatorio, y la solicitud sigue en revisión manual', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    const cliente = await solicitante();

    for (const cuerpo of [{}, { motivo: '' }, { motivo: '   ' }]) {
      const respuesta = await rechazar(
        administrador.token,
        cliente.codigoPublico,
        cuerpo,
      ).expect(400);
      expect(JSON.stringify(respuesta.body)).toContain(
        'El motivo del rechazo es obligatorio.',
      );
    }
    const corto = await rechazar(administrador.token, cliente.codigoPublico, {
      motivo: 'No sirve',
    }).expect(400);
    expect(JSON.stringify(corto.body)).toContain('al menos 10 caracteres');

    const guardada = await solicitud(cliente.solicitudId);
    expect(guardada).toMatchObject({
      estado: 'revision_manual',
      motivoRechazo: null,
      resolutorId: null,
      fechaResolucion: null,
    });
  });

  it('RNF-03 · sin sesión 401; cliente, vendedor y bodeguero 403, sin cambios', async () => {
    const cliente = await solicitante();

    await aprobar(null, cliente.codigoPublico).expect(401);
    await rechazar(null, cliente.codigoPublico, { motivo: MOTIVO }).expect(401);
    for (const rol of [
      ROLES.CLIENTE,
      ROLES.PROFESIONAL,
      ROLES.VENDEDOR,
      ROLES.BODEGUERO,
    ]) {
      const otra = await cuenta(rol);
      await aprobar(otra.token, cliente.codigoPublico).expect(403);
      await rechazar(otra.token, cliente.codigoPublico, {
        motivo: MOTIVO,
      }).expect(403);
    }
    // Ni siquiera sobre su propia solicitud
    await aprobar(cliente.token, cliente.codigoPublico).expect(403);

    expect((await solicitud(cliente.solicitudId)).estado).toBe(
      'revision_manual',
    );
  });

  it('solicitud que no está en revisión manual: 409 sin cambios', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);

    for (const estado of [
      ESTADOS_SOLICITUD.PENDIENTE,
      ESTADOS_SOLICITUD.APROBADA,
      ESTADOS_SOLICITUD.RECHAZADA,
    ]) {
      const cliente = await solicitante(estado);
      await aprobar(administrador.token, cliente.codigoPublico).expect(409);
      await rechazar(administrador.token, cliente.codigoPublico, {
        motivo: MOTIVO,
      }).expect(409);
      expect((await solicitud(cliente.solicitudId)).estado).toBe(estado);
    }
  });

  it('no aprueba una cuenta desactivada o que dejó de ser cliente (409), pero sí permite rechazarla', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    const desactivada = await solicitante();
    const ahoraPersonal = await solicitante();
    await prisma.usuario.update({
      where: { id: desactivada.id },
      data: { activo: false },
    });
    await prisma.usuario.update({
      where: { id: ahoraPersonal.id },
      data: { rol: ROLES.VENDEDOR },
    });

    for (const cliente of [desactivada, ahoraPersonal]) {
      await aprobar(administrador.token, cliente.codigoPublico).expect(409);
      expect((await solicitud(cliente.solicitudId)).estado).toBe(
        'revision_manual',
      );
    }
    await rechazar(administrador.token, desactivada.codigoPublico, {
      motivo: MOTIVO,
    }).expect(200);
    expect((await solicitud(desactivada.solicitudId)).estado).toBe('rechazada');
  });

  it('cuenta inexistente o sin solicitudes: 404; código que no es UUID: 400', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    const sinSolicitud = await cuenta();

    await aprobar(administrador.token, randomUUID()).expect(404);
    await aprobar(administrador.token, sinSolicitud.codigoPublico).expect(404);
    await aprobar(administrador.token, '123').expect(400);
  });

  it('dos resoluciones a la vez: solo una se aplica y la otra recibe 409', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    const cliente = await solicitante();

    const respuestas = await Promise.all([
      aprobar(administrador.token, cliente.codigoPublico),
      rechazar(administrador.token, cliente.codigoPublico, { motivo: MOTIVO }),
    ]);

    expect(respuestas.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    const ganadora = respuestas.find((r) => r.status === 200);
    const guardada = await solicitud(cliente.solicitudId);
    expect(guardada.estado).toBe(
      (ganadora?.body as { estado: string } | undefined)?.estado,
    );
  });

  it('con varias solicitudes resuelve la más reciente y no toca las anteriores', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    const cliente = await cuenta();
    const antigua = await prisma.solicitudVerificacion.create({
      data: {
        solicitanteId: cliente.id,
        estado: ESTADOS_SOLICITUD.RECHAZADA,
        motivoRechazo: 'Rechazo anterior.',
      },
    });
    const nueva = await prisma.solicitudVerificacion.create({
      data: {
        solicitanteId: cliente.id,
        estado: ESTADOS_SOLICITUD.REVISION_MANUAL,
      },
    });

    await aprobar(administrador.token, cliente.codigoPublico).expect(200);

    expect((await solicitud(nueva.id)).estado).toBe('aprobada');
    expect(await solicitud(antigua.id)).toMatchObject({
      estado: 'rechazada',
      motivoRechazo: 'Rechazo anterior.',
    });
  });
});
