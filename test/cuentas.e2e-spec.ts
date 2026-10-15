import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Job, Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { COLAS, type TrabajoConfirmacionCorreo } from '../src/colas/colas.js';
import { normalizarRut } from '../src/common/dominio/rut.js';
import { ESTADOS_NOTIFICACION } from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { hashearTokenCorreo } from '../src/modulos/cuentas/tokens.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

/** RUT válido y distinto en cada corrida, para no chocar con datos previos. */
const rutAleatorio = (): string => {
  for (;;) {
    const cuerpo = String(10_000_000 + Math.floor(Math.random() * 89_999_999));
    for (const dv of '0123456789K') {
      const rut = normalizarRut(`${cuerpo}-${dv}`);
      if (rut) return rut;
    }
  }
};

describe('Cuentas · registro y confirmación (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let correos: Queue<TrabajoConfirmacionCorreo>;
  const correosCreados: string[] = [];

  const nuevoRegistro = () => {
    const email = `e2e-${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    return {
      nombre: 'Camila',
      apellido: 'Rojas',
      email: email.toUpperCase(),
      contrasena: 'Secreta123',
      confirmacionContrasena: 'Secreta123',
      rut: rutAleatorio()
        .replace('-', '')
        .replace(/^(\d{2})(\d{3})/, '$1.$2.'),
    };
  };

  const trabajoDe = async (email: string) => {
    const trabajos: Job<TrabajoConfirmacionCorreo>[] = await correos.getJobs([
      'prioritized',
      'waiting',
      'delayed',
    ]);
    return trabajos.find((t) => t.data.destinatario === email);
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    correos = app.get(getQueueToken(COLAS.CORREOS));
  });

  afterAll(async () => {
    for (const email of correosCreados) {
      await (await trabajoDe(email))?.remove();
    }
    const usuarios = await prisma.usuario.findMany({
      where: { email: { in: correosCreados } },
      select: { id: true },
    });
    const ids = usuarios.map((u) => u.id);
    await prisma.notificacion.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('E1-H1 · registro exitoso: crea la cuenta inactiva, envía el token y responde con éxito', async () => {
    const cuerpo = nuevoRegistro();
    const email = cuerpo.email.toLowerCase();

    const respuesta = await request(app.getHttpServer())
      .post('/api/cuentas/registro')
      .send(cuerpo)
      .expect(201);
    expect(respuesta.body.mensaje).toMatch(/cuenta fue creada/);

    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { email },
      include: { tokensCorreo: true, notificaciones: true },
    });
    expect(usuario.fechaVerificacionCorreo).toBeNull();
    expect(usuario.rut).toBe(normalizarRut(cuerpo.rut));
    expect(usuario.contrasenaHash).not.toContain('Secreta123');
    expect(usuario.tokensCorreo).toHaveLength(1);
    expect(usuario.notificaciones[0].estadoEnvio).toBe(
      ESTADOS_NOTIFICACION.PENDIENTE,
    );

    const trabajo = await trabajoDe(email);
    expect(trabajo).toBeDefined();
    const token = new URL(trabajo!.data.enlace).searchParams.get('token')!;
    expect(hashearTokenCorreo(token)).toBe(usuario.tokensCorreo[0].tokenHash);
  });

  it('E1-H1 · registro exitoso: contraseñas distintas responden 400 y no crean la cuenta', async () => {
    const cuerpo = { ...nuevoRegistro(), confirmacionContrasena: 'Otra12345' };
    await request(app.getHttpServer())
      .post('/api/cuentas/registro')
      .send(cuerpo)
      .expect(400);
    expect(
      await prisma.usuario.count({
        where: { email: cuerpo.email.toLowerCase() },
      }),
    ).toBe(0);
  });

  it('E1-H1 · registro: rechaza contraseña débil, RUT inválido y campos extra', async () => {
    const servidor = app.getHttpServer();
    await request(servidor)
      .post('/api/cuentas/registro')
      .send({
        ...nuevoRegistro(),
        contrasena: 'solotexto',
        confirmacionContrasena: 'solotexto',
      })
      .expect(400);
    await request(servidor)
      .post('/api/cuentas/registro')
      .send({ ...nuevoRegistro(), rut: '12.345.678-9' })
      .expect(400);
    await request(servidor)
      .post('/api/cuentas/registro')
      .send({ ...nuevoRegistro(), rol: 'administrador' })
      .expect(400);
  });

  it('E1-H1 · correo o RUT ya registrado: no crea la cuenta e informa el dato', async () => {
    const servidor = app.getHttpServer();
    const primero = nuevoRegistro();
    await request(servidor)
      .post('/api/cuentas/registro')
      .send(primero)
      .expect(201);

    const mismoCorreo = { ...nuevoRegistro(), email: primero.email };
    const r1 = await request(servidor)
      .post('/api/cuentas/registro')
      .send(mismoCorreo)
      .expect(409);
    expect(r1.body.message).toBe('El correo ya está registrado.');

    const mismoRut = { ...nuevoRegistro(), rut: primero.rut };
    const r2 = await request(servidor)
      .post('/api/cuentas/registro')
      .send(mismoRut)
      .expect(409);
    expect(r2.body.message).toBe('El RUT ya está registrado.');

    // Sigue existiendo una sola cuenta con ese correo y ninguna con el RUT repetido
    expect(
      await prisma.usuario.count({
        where: { email: primero.email.toLowerCase() },
      }),
    ).toBe(1);
    expect(
      await prisma.usuario.count({
        where: { email: mismoRut.email.toLowerCase() },
      }),
    ).toBe(0);
  });

  it('E1-H1 · confirmación del correo: con enlace vigente el correo queda verificado y el enlace no se reutiliza', async () => {
    const servidor = app.getHttpServer();
    const cuerpo = nuevoRegistro();
    const email = cuerpo.email.toLowerCase();
    await request(servidor)
      .post('/api/cuentas/registro')
      .send(cuerpo)
      .expect(201);
    const trabajo = await trabajoDe(email);
    const token = new URL(trabajo!.data.enlace).searchParams.get('token')!;

    await request(servidor)
      .post('/api/cuentas/confirmar-correo')
      .send({ token })
      .expect(200);

    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { email },
      include: { tokensCorreo: true },
    });
    expect(usuario.fechaVerificacionCorreo).toBeInstanceOf(Date);
    expect(usuario.tokensCorreo[0].fechaUso).toBeInstanceOf(Date);

    await request(servidor)
      .post('/api/cuentas/confirmar-correo')
      .send({ token })
      .expect(400);
  });

  it('E1-H1 · confirmación del correo: un enlace vencido responde 400', async () => {
    const servidor = app.getHttpServer();
    const cuerpo = nuevoRegistro();
    const email = cuerpo.email.toLowerCase();
    await request(servidor)
      .post('/api/cuentas/registro')
      .send(cuerpo)
      .expect(201);
    const trabajo = await trabajoDe(email);
    const token = new URL(trabajo!.data.enlace).searchParams.get('token')!;

    await prisma.tokenCorreo.update({
      where: { tokenHash: hashearTokenCorreo(token) },
      data: { fechaExpiracion: new Date(Date.now() - 1_000) },
    });

    await request(servidor)
      .post('/api/cuentas/confirmar-correo')
      .send({ token })
      .expect(400);
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { email },
    });
    expect(usuario.fechaVerificacionCorreo).toBeNull();
  });

  it('E1-H1 · confirmación del correo: un token inventado responde 400', async () => {
    await request(app.getHttpServer())
      .post('/api/cuentas/confirmar-correo')
      .send({ token: 'no-existe' })
      .expect(400);
  });
});
