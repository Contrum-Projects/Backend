import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoCorreoConEnlace,
} from '../src/colas/colas.js';
import { ROLES } from '../src/common/dominio/roles.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
  TIPOS_TOKEN,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import {
  generarTokenCorreo,
  hashearTokenCorreo,
} from '../src/modulos/cuentas/tokens.js';
import {
  CLIENTE_CORREO,
  ErrorEnvioCorreo,
  type MensajeCorreo,
} from '../src/modulos/notificaciones/cliente-correo.js';
import { CorreosProcessor } from '../src/modulos/notificaciones/correos.processor.js';
import { RevisionCorreosService } from '../src/modulos/notificaciones/revision-correos.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const OPCIONES = { removeOnComplete: true, removeOnFail: true };
const HACE_UNA_HORA = () => new Date(Date.now() - 60 * 60 * 1000);

describe('Envío de correos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let correos: Queue;
  let redis: Redis;
  let revision: RevisionCorreosService;
  const enviados: MensajeCorreo[] = [];
  const rechazados = new Set<string>();
  const creados: number[] = [];

  const cliente = {
    enviar: (mensaje: MensajeCorreo): Promise<void> => {
      if (rechazados.has(mensaje.para)) {
        return Promise.reject(new ErrorEnvioCorreo('Resend rechazó el envío'));
      }
      enviados.push(mensaje);
      return Promise.resolve();
    },
  };

  /** Cuenta con un enlace vigente y su NOTIFICACION pendiente, sin trabajo en la cola. */
  const cuentaConCorreoPendiente = async (fechaCreacion = new Date()) => {
    const email = `e2e-${randomUUID()}@prueba.cl`;
    const { token, hash } = generarTokenCorreo();
    const fechaExpiracion = new Date(Date.now() + 60 * 60 * 1000);
    const usuario = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Camila',
        apellido: 'Rojas',
        email,
        contrasenaHash: 'hash',
        rol: ROLES.CLIENTE,
      },
      select: { id: true },
    });
    creados.push(usuario.id);
    await prisma.tokenCorreo.create({
      data: {
        usuarioId: usuario.id,
        tipo: TIPOS_TOKEN.CONFIRMACION_CORREO,
        tokenHash: hash,
        fechaExpiracion,
      },
    });
    const notificacion = await prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        tipo: TIPOS_NOTIFICACION.CONFIRMACION_CORREO,
        asunto: 'Confirma tu correo',
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
        fechaCreacion,
      },
      select: { id: true },
    });
    return {
      email,
      token,
      hash,
      fechaExpiracion,
      usuarioId: usuario.id,
      notificacionId: notificacion.id,
    };
  };

  const datosDe = ({
    notificacionId,
    email,
    token,
  }: {
    notificacionId: number;
    email: string;
    token: string;
  }): TrabajoCorreoConEnlace => ({
    notificacionId,
    destinatario: email,
    nombre: 'Camila',
    enlace: `https://tienda.cl/confirmar-correo?token=${token}`,
  });

  const estadoDe = async (id: number) =>
    (await prisma.notificacion.findUniqueOrThrow({ where: { id } }))
      .estadoEnvio;

  const esperarEstado = (id: number, estado: string) =>
    vi.waitFor(async () => expect(await estadoDe(id)).toBe(estado), {
      timeout: 30_000,
      interval: 100,
    });

  /** Nada de lo que la cola guarda en Redis contiene el token. */
  const expectSinTokenEnRedis = async (token: string) => {
    const claves = await redis.keys('bull:correos:*');
    for (const clave of claves) {
      const tipo = await redis.type(clave);
      if (tipo !== 'hash') continue;
      expect(JSON.stringify(await redis.hgetall(clave))).not.toContain(token);
    }
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLIENTE_CORREO)
      .useValue(cliente)
      .compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    correos = app.get(getQueueToken(COLAS.CORREOS));
    redis = app.get(REDIS);
    revision = app.get(RevisionCorreosService);
    // Los demás e2e dejan trabajos en la cola, porque ahí el worker está apagado: sin vaciarla, los
    // correos de estas pruebas esperarían detrás de todos ellos, con el límite de envíos por segundo
    await correos.obliterate({ force: true });
    // Los e2e parten con el worker apagado: solo este archivo lo necesita
    app.get(CorreosProcessor).iniciar();
  });

  afterAll(async () => {
    await correos.removeJobScheduler(TRABAJOS_CORREO.REVISAR_PENDIENTES);
    await app.close();
    await prisma.notificacion.deleteMany({
      where: { usuarioId: { in: creados } },
    });
    await prisma.usuario.deleteMany({ where: { id: { in: creados } } });
  });

  it('E1-H6 · correo enviado: el worker lo envía al destinatario con su plantilla y la NOTIFICACION queda enviada', async () => {
    const cuenta = await cuentaConCorreoPendiente();

    await correos.add(TRABAJOS_CORREO.CONFIRMACION_CORREO, datosDe(cuenta), {
      ...OPCIONES,
      jobId: `correo-${cuenta.notificacionId}`,
    });

    await esperarEstado(cuenta.notificacionId, ESTADOS_NOTIFICACION.ENVIADA);
    const mensaje = enviados.find((m) => m.para === cuenta.email);
    expect(mensaje?.asunto).toBe('Confirma tu correo');
    expect(mensaje?.html).toContain('Confirmar mi correo');
    expect(mensaje?.html).toContain(cuenta.token);
    const notificacion = await prisma.notificacion.findUniqueOrThrow({
      where: { id: cuenta.notificacionId },
    });
    expect(notificacion.fechaEnvio).not.toBeNull();
    expect(notificacion.intentos).toBe(1);
  }, 40_000);

  it('E1-H6 · envío fallido: al agotar los reintentos queda fallida, sin afectar a la cuenta', async () => {
    const cuenta = await cuentaConCorreoPendiente();
    rechazados.add(cuenta.email);

    await correos.add(TRABAJOS_CORREO.CONFIRMACION_CORREO, datosDe(cuenta), {
      ...OPCIONES,
      jobId: `correo-${cuenta.notificacionId}`,
      attempts: 2,
      backoff: { type: 'fixed', delay: 50 },
    });

    await esperarEstado(cuenta.notificacionId, ESTADOS_NOTIFICACION.FALLIDA);
    const notificacion = await prisma.notificacion.findUniqueOrThrow({
      where: { id: cuenta.notificacionId },
    });
    expect(notificacion.intentos).toBe(2);
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: cuenta.usuarioId },
    });
    expect(usuario.activo).toBe(true);
    const token = await prisma.tokenCorreo.findFirstOrThrow({
      where: { usuarioId: cuenta.usuarioId },
    });
    expect(token.fechaUso).toBeNull();
    expect(token.tokenHash).toBe(cuenta.hash);
  }, 40_000);

  it('E1-H6 · correo pendiente tras una caída de Redis: la revisión lo vuelve a encolar y se envía', async () => {
    const cuenta = await cuentaConCorreoPendiente(HACE_UNA_HORA());

    await revision.revisarPendientes();

    await esperarEstado(cuenta.notificacionId, ESTADOS_NOTIFICACION.ENVIADA);
    const mensaje = enviados.find((m) => m.para === cuenta.email);
    const enlace = /token=([\w%-]+)/.exec(mensaje?.texto ?? '')?.[1] ?? '';
    const tokenNuevo = decodeURIComponent(enlace);
    expect(tokenNuevo).not.toBe(cuenta.token);

    // El enlace del correo sirve, con el vencimiento original; el token perdido ya no existe
    const token = await prisma.tokenCorreo.findFirstOrThrow({
      where: { usuarioId: cuenta.usuarioId },
    });
    expect(token.tokenHash).toBe(hashearTokenCorreo(tokenNuevo));
    expect(token.tokenHash).not.toBe(cuenta.hash);
    expect(token.fechaExpiracion).toEqual(cuenta.fechaExpiracion);
  }, 40_000);

  it('E1-H6 · correo pendiente: un correo recién creado todavía no se reencola', async () => {
    const cuenta = await cuentaConCorreoPendiente();

    await revision.revisarPendientes();

    expect(await correos.getJob(`correo-${cuenta.notificacionId}`)).toBeFalsy();
    expect(await estadoDe(cuenta.notificacionId)).toBe(
      ESTADOS_NOTIFICACION.PENDIENTE,
    );
    await prisma.notificacion.update({
      where: { id: cuenta.notificacionId },
      data: { estadoEnvio: ESTADOS_NOTIFICACION.FALLIDA },
    });
  });

  it('E1-H6 · enlace protegido: bien o mal, el trabajo y su token no quedan en Redis', async () => {
    const bien = await cuentaConCorreoPendiente();
    const mal = await cuentaConCorreoPendiente();
    rechazados.add(mal.email);

    await correos.add(TRABAJOS_CORREO.CONFIRMACION_CORREO, datosDe(bien), {
      ...OPCIONES,
      jobId: `correo-${bien.notificacionId}`,
    });
    await correos.add(TRABAJOS_CORREO.CONFIRMACION_CORREO, datosDe(mal), {
      ...OPCIONES,
      jobId: `correo-${mal.notificacionId}`,
      attempts: 1,
    });

    await esperarEstado(bien.notificacionId, ESTADOS_NOTIFICACION.ENVIADA);
    await esperarEstado(mal.notificacionId, ESTADOS_NOTIFICACION.FALLIDA);

    await vi.waitFor(
      async () => {
        expect(
          await correos.getJob(`correo-${bien.notificacionId}`),
        ).toBeFalsy();
        expect(
          await correos.getJob(`correo-${mal.notificacionId}`),
        ).toBeFalsy();
      },
      { timeout: 5_000, interval: 100 },
    );
    await expectSinTokenEnRedis(bien.token);
    await expectSinTokenEnRedis(mal.token);
  }, 40_000);

  it('RNF-29 · Redis vuelve sin sus datos: al reconectar crea de nuevo la revisión de correos', async () => {
    const tarea = TRABAJOS_CORREO.REVISAR_PENDIENTES;
    await correos.removeJobScheduler(tarea);
    expect(await correos.getJobScheduler(tarea)).toBeUndefined();

    (await correos.getBackend().client).disconnect(true);

    await vi.waitFor(
      async () => expect(await correos.getJobScheduler(tarea)).toBeDefined(),
      { timeout: 10_000, interval: 100 },
    );
  }, 15_000);
});
