import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Job, Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoConfirmacionSuscripcion,
} from '../src/colas/colas.js';
import {
  ESTADOS_NOTIFICACION,
  ORIGENES_LEAD,
  TIPOS_NOTIFICACION,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

describe('Marketing · suscripción a ofertas sin cuenta (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let correos: Queue<TrabajoConfirmacionSuscripcion>;
  let redis: Redis;
  const correosCreados: string[] = [];

  const nuevoCorreo = () => {
    const email = `e2e-${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    return email;
  };

  const trabajosDe = async (email: string) => {
    const trabajos: Job<TrabajoConfirmacionSuscripcion>[] =
      await correos.getJobs(['prioritized', 'waiting', 'delayed']);
    return trabajos.filter(
      (t) =>
        t.name === TRABAJOS_CORREO.CONFIRMACION_SUSCRIPCION &&
        t.data.destinatario === email,
    );
  };

  /** El servicio encola sin esperar la cola: el trabajo puede llegar un instante después del 202. */
  const esperarTrabajo = (email: string) =>
    vi.waitFor(
      async () => {
        const [trabajo] = await trabajosDe(email);
        if (!trabajo) throw new Error(`Sin trabajo para ${email}`);
        return trabajo;
      },
      { timeout: 3_000, interval: 50 },
    );

  const tokenDe = async (email: string) => {
    const trabajo = await esperarTrabajo(email);
    return new URL(trabajo.data.enlace).searchParams.get('token')!;
  };

  const suscribir = (email: string) =>
    request(app.getHttpServer())
      .post('/api/marketing/suscripciones')
      .send({ email });

  const confirmar = (token: string) =>
    request(app.getHttpServer())
      .post('/api/marketing/suscripciones/confirmar')
      .send({ token });

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    correos = app.get(getQueueToken(COLAS.CORREOS));
    redis = app.get(REDIS);
  });

  // Todas las peticiones salen de la misma IP: cada prueba parte sin contadores
  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
  });

  afterAll(async () => {
    for (const email of correosCreados) {
      for (const trabajo of await trabajosDe(email)) await trabajo.remove();
    }
    const leads = await prisma.lead.findMany({
      where: { email: { in: correosCreados } },
      select: { id: true },
    });
    const ids = leads.map((l) => l.id);
    await prisma.notificacion.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('E12-H1 · solicitud de suscripción: registra la suscripción inactiva y encola el correo de confirmación', async () => {
    const email = nuevoCorreo();

    const respuesta = await suscribir(`  ${email.toUpperCase()} `).expect(202);
    expect(respuesta.body.mensaje).toMatch(/correo para confirmarla/);

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { email },
      include: { notificaciones: true },
    });
    expect(lead.activo).toBe(false);
    expect(lead.fechaBaja).toBeNull();
    expect(lead.origen).toBe(ORIGENES_LEAD.FORMULARIO_WEB);
    expect(lead.notificaciones).toHaveLength(1);
    expect(lead.notificaciones[0]).toMatchObject({
      tipo: TIPOS_NOTIFICACION.CONFIRMACION_SUSCRIPCION,
      estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
      usuarioId: null,
    });

    const trabajo = await esperarTrabajo(email);
    expect(trabajo.id).toBe(`correo-${lead.notificaciones[0].id}`);
    expect(trabajo.opts.priority).toBe(5);
    expect(trabajo.data.enlace).toMatch(/\/suscripcion\/confirmar\?token=/);
  });

  it('E12-H1 · solicitud de suscripción: correo inválido o campos extra responden 400 sin registrar nada', async () => {
    await suscribir('no-es-correo').expect(400);
    await request(app.getHttpServer())
      .post('/api/marketing/suscripciones')
      .send({ email: nuevoCorreo(), activo: true })
      .expect(400);
  });

  it('E12-H1 · suscripción confirmada: el enlace firmado activa la suscripción y confirmar de nuevo responde lo mismo', async () => {
    const email = nuevoCorreo();
    await suscribir(email).expect(202);
    const token = await tokenDe(email);

    const respuesta = await confirmar(token).expect(200);
    expect(respuesta.body.mensaje).toMatch(/suscripción quedó confirmada/);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { email } });
    expect(lead.activo).toBe(true);

    await confirmar(token).expect(200);
  });

  it('E12-H1 · RNF-09: una segunda solicitud del mismo correo antes de 15 minutos responde igual y no envía otra confirmación', async () => {
    const email = nuevoCorreo();
    await suscribir(email).expect(202);
    await esperarTrabajo(email);

    const respuesta = await suscribir(email).expect(202);

    expect(respuesta.body.mensaje).toMatch(/correo para confirmarla/);
    expect(
      await prisma.notificacion.count({ where: { lead: { email } } }),
    ).toBe(1);
    expect(await trabajosDe(email)).toHaveLength(1);
  });

  it('E12-H1 · RNF-09: dos solicitudes simultáneas del mismo correo dejan una sola confirmación', async () => {
    const email = nuevoCorreo();

    await Promise.all([
      suscribir(email).expect(202),
      suscribir(email).expect(202),
    ]);

    expect(
      await prisma.notificacion.count({ where: { lead: { email } } }),
    ).toBe(1);
  });

  it('E12-H1 · solicitud de suscripción: con el correo ya confirmado responde igual y no envía otro correo', async () => {
    const email = nuevoCorreo();
    await suscribir(email).expect(202);
    await confirmar(await tokenDe(email)).expect(200);

    const respuesta = await suscribir(email).expect(202);

    expect(respuesta.body.mensaje).toMatch(/correo para confirmarla/);
    expect(
      await prisma.notificacion.count({ where: { lead: { email } } }),
    ).toBe(1);
  });

  it('E12-H1 · suscripción confirmada: un token alterado o inventado responde 400 y no activa nada', async () => {
    const email = nuevoCorreo();
    await suscribir(email).expect(202);
    const token = await tokenDe(email);
    const [emitido, vence, correo, firma] = token.split('.');
    // Se cambia el primer carácter: los 2 últimos bits del último no cuentan en base64url
    const otraFirma = `${firma.startsWith('A') ? 'B' : 'A'}${firma.slice(1)}`;

    await confirmar(
      `${emitido}.${Number(vence) + 1}.${correo}.${firma}`,
    ).expect(400);
    await confirmar(`${emitido}.${vence}.${correo}.${otraFirma}`).expect(400);
    await confirmar('inventado').expect(400);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { email } });
    expect(lead.activo).toBe(false);
  });

  it('E12-H1 · suscripción confirmada: un enlace emitido antes de la baja no la deshace', async () => {
    const email = nuevoCorreo();
    await suscribir(email).expect(202);
    const token = await tokenDe(email);
    await prisma.lead.update({
      where: { email },
      data: { activo: false, fechaBaja: new Date(Date.now() + 1_000) },
    });

    await confirmar(token).expect(400);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { email } });
    expect(lead.activo).toBe(false);
  });

  it('E12-H1 · exceso de solicitudes: la sexta suscripción en un minuto desde la misma IP responde 429', async () => {
    for (let i = 0; i < 5; i++) {
      await suscribir(nuevoCorreo()).expect(202);
    }
    await suscribir(nuevoCorreo()).expect(429);
  });

  it('E12-H1 · exceso de solicitudes: la sexta confirmación en un minuto desde la misma IP responde 429', async () => {
    for (let i = 0; i < 5; i++) {
      await confirmar('inventado').expect(400);
    }
    await confirmar('inventado').expect(429);
  });
});
