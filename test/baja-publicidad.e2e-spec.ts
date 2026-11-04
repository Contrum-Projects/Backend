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
  ESTADOS_NOTIFICACION,
  ORIGENES_LEAD,
  TIPOS_CAMPANA,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { FirmaBaja } from '../src/modulos/marketing/firma-baja.js';
import { FirmaSuscripcion } from '../src/modulos/marketing/firma-suscripcion.js';
import {
  CLIENTE_CORREO,
  type MensajeCorreo,
} from '../src/modulos/notificaciones/cliente-correo.js';
import { EnvioCorreosService } from '../src/modulos/notificaciones/envio-correos.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA_CONSENTIMIENTO = '/api/cuentas/yo/consentimiento-marketing';
const RUTA_BAJA = '/api/marketing/bajas';

interface Consentimiento {
  acepta: boolean;
  fechaConsentimiento: string | null;
}

describe('Marketing · consentimiento de publicidad y baja desde el correo (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let firma: FirmaBaja;
  let envio: EnvioCorreosService;
  let hashContrasena: string;
  const enviados: MensajeCorreo[] = [];
  const correosCreados: string[] = [];

  const nuevoCorreo = () => {
    const email = `e2e-baja-${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    return email;
  };

  const crearCuenta = (rol: Rol, email = nuevoCorreo()) =>
    prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Prueba',
        apellido: 'E2E',
        email,
        contrasenaHash: hashContrasena,
        rol,
        fechaVerificacionCorreo: new Date(),
      },
      select: { id: true, email: true },
    });

  const iniciarSesion = async (email: string) => {
    const respuesta = await request(app.getHttpServer())
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  const elegir = (token: string, acepta: unknown) =>
    request(app.getHttpServer())
      .put(RUTA_CONSENTIMIENTO)
      .auth(token, { type: 'bearer' })
      .send({ acepta });

  const darDeBaja = (token: string) =>
    request(app.getHttpServer()).post(RUTA_BAJA).send({ token });

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLIENTE_CORREO)
      .useValue({
        enviar: (mensaje: MensajeCorreo) => {
          enviados.push(mensaje);
          return Promise.resolve();
        },
      })
      .compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    firma = app.get(FirmaBaja);
    envio = app.get(EnvioCorreosService);
    hashContrasena = await argon2.hash(CONTRASENA);
  });

  // Todas las peticiones salen de la misma IP: cada prueba parte sin contadores
  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
  });

  afterAll(async () => {
    const email = { in: correosCreados };
    await prisma.notificacion.deleteMany({
      where: { OR: [{ usuario: { email } }, { lead: { email } }] },
    });
    await prisma.campana.deleteMany({ where: { usuario: { email } } });
    await prisma.lead.deleteMany({ where: { email } });
    await prisma.sesion.deleteMany({ where: { usuario: { email } } });
    await prisma.usuario.deleteMany({ where: { email } });
    await app.close();
  });

  describe('E12-H2 · consentimiento en la cuenta', () => {
    it('E12-H2 · consentimiento en la cuenta: activar las ofertas guarda la preferencia y la fecha, y se ve en mis datos', async () => {
      const cuenta = await crearCuenta(ROLES.CLIENTE);
      const token = await iniciarSesion(cuenta.email);
      const antes = Date.now();

      const respuesta = await elegir(token, true).expect(200);

      const cuerpo = respuesta.body as Consentimiento;
      expect(cuerpo.acepta).toBe(true);
      expect(
        new Date(cuerpo.fechaConsentimiento!).getTime(),
      ).toBeGreaterThanOrEqual(antes - 1_000);
      const guardado = await prisma.usuario.findUniqueOrThrow({
        where: { id: cuenta.id },
      });
      expect(guardado.aceptaMarketingEmail).toBe(true);
      expect(guardado.fechaConsentimientoMarketing?.toISOString()).toBe(
        cuerpo.fechaConsentimiento,
      );

      const datos = await request(app.getHttpServer())
        .get('/api/cuentas/yo')
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(
        (datos.body as { consentimientoMarketing: Consentimiento })
          .consentimientoMarketing,
      ).toEqual(cuerpo);
    });

    it('E12-H2 · consentimiento en la cuenta: activarlo otra vez no cambia la fecha y desactivarlo la conserva', async () => {
      const cuenta = await crearCuenta(ROLES.PROFESIONAL);
      const token = await iniciarSesion(cuenta.email);
      const primera = (await elegir(token, true).expect(200))
        .body as Consentimiento;

      const repetida = (await elegir(token, true).expect(200))
        .body as Consentimiento;
      const desactivada = (await elegir(token, false).expect(200))
        .body as Consentimiento;

      expect(repetida.fechaConsentimiento).toBe(primera.fechaConsentimiento);
      expect(desactivada).toEqual({
        acepta: false,
        fechaConsentimiento: primera.fechaConsentimiento,
      });
    });

    it.each([[undefined], ['si'], [null]])(
      'E12-H2 · consentimiento en la cuenta: acepta=%s responde 400',
      async (acepta) => {
        const cuenta = await crearCuenta(ROLES.CLIENTE);
        const token = await iniciarSesion(cuenta.email);

        await elegir(token, acepta).expect(400);
      },
    );

    it('E12-H2 · RNF-03: sin sesión responde 401 y el personal de tienda recibe 403', async () => {
      await request(app.getHttpServer())
        .put(RUTA_CONSENTIMIENTO)
        .send({ acepta: true })
        .expect(401);

      const vendedor = await crearCuenta(ROLES.VENDEDOR);
      await elegir(await iniciarSesion(vendedor.email), true).expect(403);
    });
  });

  describe('E12-H2 · baja desde un correo', () => {
    it('E12-H2 · baja desde un correo: deja de enviar publicidad a la dirección, sea de una cuenta o de un suscriptor', async () => {
      const email = nuevoCorreo();
      const cuenta = await crearCuenta(ROLES.CLIENTE, email);
      await prisma.usuario.update({
        where: { id: cuenta.id },
        data: {
          aceptaMarketingEmail: true,
          fechaConsentimientoMarketing: new Date('2026-10-01T00:00:00Z'),
        },
      });
      await prisma.lead.create({
        data: { email, origen: ORIGENES_LEAD.FORMULARIO_WEB, activo: true },
      });

      await darDeBaja(firma.firmar(email)).expect(200);

      const usuario = await prisma.usuario.findUniqueOrThrow({
        where: { id: cuenta.id },
      });
      expect(usuario.aceptaMarketingEmail).toBe(false);
      expect(usuario.fechaConsentimientoMarketing).toEqual(
        new Date('2026-10-01T00:00:00Z'),
      );
      const lead = await prisma.lead.findUniqueOrThrow({ where: { email } });
      expect(lead.activo).toBe(false);
      expect(lead.fechaBaja).not.toBeNull();
    });

    it('E12-H2 · baja desde un correo: repetirla responde lo mismo', async () => {
      const email = nuevoCorreo();
      await prisma.lead.create({
        data: { email, origen: ORIGENES_LEAD.FORMULARIO_WEB, activo: true },
      });
      const token = firma.firmar(email);

      const primera = await darDeBaja(token).expect(200);
      const segunda = await darDeBaja(token).expect(200);

      expect(segunda.body).toEqual(primera.body);
      expect(
        (await prisma.lead.findUniqueOrThrow({ where: { email } })).activo,
      ).toBe(false);
    });

    it('E12-H2 · baja desde un correo: tras una baja previa y una nueva suscripción pendiente, la baja invalida el enlace de confirmación anterior', async () => {
      const email = nuevoCorreo();
      await prisma.lead.create({
        data: {
          email,
          origen: ORIGENES_LEAD.FORMULARIO_WEB,
          activo: false,
          fechaBaja: new Date(Date.now() - 60 * 60_000),
        },
      });
      // Enlace de confirmación pedido después de la baja previa
      const confirmacion = app
        .get(FirmaSuscripcion)
        .firmar(
          email,
          new Date(Date.now() - 1_000),
          new Date(Date.now() + 60 * 60_000),
        );

      await darDeBaja(firma.firmar(email)).expect(200);

      await request(app.getHttpServer())
        .post('/api/marketing/suscripciones/confirmar')
        .send({ token: confirmacion })
        .expect(400);
      expect(
        (await prisma.lead.findUniqueOrThrow({ where: { email } })).activo,
      ).toBe(false);
    });

    it('E12-H2 · baja desde un correo: una dirección sin cuenta ni suscripción responde lo mismo (no revela si existe)', async () => {
      const conLead = nuevoCorreo();
      await prisma.lead.create({
        data: { email: conLead, origen: ORIGENES_LEAD.FORMULARIO_WEB },
      });

      const existente = await darDeBaja(firma.firmar(conLead)).expect(200);
      const inexistente = await darDeBaja(
        firma.firmar(`nadie-${randomUUID()}@prueba.cl`),
      ).expect(200);

      expect(inexistente.body).toEqual(existente.body);
    });

    it('E12-H2 · baja desde un correo: un enlace alterado o vacío responde 400 (RNF-08)', async () => {
      const email = nuevoCorreo();
      const [, sello] = firma.firmar(email).split('.');
      const otro = Buffer.from('otra@prueba.cl').toString('base64url');

      await darDeBaja(`${otro}.${sello}`).expect(400);
      await darDeBaja('').expect(400);
    });

    it('E12-H2 · RNF-09: más de 5 bajas por minuto desde la misma IP responden 429', async () => {
      const token = firma.firmar(nuevoCorreo());
      for (let i = 0; i < 5; i++) await darDeBaja(token).expect(200);

      await darDeBaja(token).expect(429);
    });
  });

  describe('E12-H2 · baja con correos pendientes', () => {
    /** Publicidad de una campaña en cola para esa dirección, sin trabajo en Redis. */
    const publicidadPendiente = async (destino: {
      usuarioId?: number;
      leadId?: number;
    }) => {
      const autor = await crearCuenta(ROLES.ADMINISTRADOR);
      const campana = await prisma.campana.create({
        data: {
          usuarioId: autor.id,
          tipo: TIPOS_CAMPANA.ENVIO_UNICO,
          asunto: 'Ofertas de noviembre',
          cuerpo: '<p>Ofertas</p>',
        },
        select: { id: true },
      });
      return prisma.notificacion.create({
        data: {
          ...destino,
          campanaId: campana.id,
          tipo: 'campana',
          asunto: 'Ofertas de noviembre',
          estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
        },
        select: { id: true },
      });
    };

    it('E12-H2 · baja con correos pendientes: la publicidad en cola para un suscriptor dado de baja no se envía y queda cancelada', async () => {
      const email = nuevoCorreo();
      const lead = await prisma.lead.create({
        data: { email, origen: ORIGENES_LEAD.FORMULARIO_WEB, activo: true },
      });
      const notificacion = await publicidadPendiente({ leadId: lead.id });

      await darDeBaja(firma.firmar(email)).expect(200);
      await envio.enviar('campana', {
        notificacionId: notificacion.id,
        destinatario: email,
        nombre: '',
      });

      expect(enviados.some((m) => m.para === email)).toBe(false);
      const guardada = await prisma.notificacion.findUniqueOrThrow({
        where: { id: notificacion.id },
      });
      expect(guardada.estadoEnvio).toBe(ESTADOS_NOTIFICACION.CANCELADA);
      expect(guardada.intentos).toBe(0);
    });

    it('E12-H2 · baja con correos pendientes: la publicidad en cola para una cuenta que se dio de baja con el enlace queda cancelada', async () => {
      const cuenta = await crearCuenta(ROLES.CLIENTE);
      await prisma.usuario.update({
        where: { id: cuenta.id },
        data: {
          aceptaMarketingEmail: true,
          fechaConsentimientoMarketing: new Date(),
        },
      });
      const notificacion = await publicidadPendiente({ usuarioId: cuenta.id });

      await darDeBaja(firma.firmar(cuenta.email)).expect(200);
      await envio.enviar('campana', {
        notificacionId: notificacion.id,
        destinatario: cuenta.email,
        nombre: 'Prueba',
      });

      expect(enviados.some((m) => m.para === cuenta.email)).toBe(false);
      expect(
        (
          await prisma.notificacion.findUniqueOrThrow({
            where: { id: notificacion.id },
          })
        ).estadoEnvio,
      ).toBe(ESTADOS_NOTIFICACION.CANCELADA);
    });

    it('E12-H2 · baja con correos pendientes: la publicidad en cola para una cuenta que desactivó las ofertas queda cancelada', async () => {
      const cuenta = await crearCuenta(ROLES.CLIENTE);
      const token = await iniciarSesion(cuenta.email);
      await elegir(token, true).expect(200);
      const notificacion = await publicidadPendiente({ usuarioId: cuenta.id });

      await elegir(token, false).expect(200);
      await envio.enviar('campana', {
        notificacionId: notificacion.id,
        destinatario: cuenta.email,
        nombre: 'Prueba',
      });

      expect(enviados.some((m) => m.para === cuenta.email)).toBe(false);
      expect(
        (
          await prisma.notificacion.findUniqueOrThrow({
            where: { id: notificacion.id },
          })
        ).estadoEnvio,
      ).toBe(ESTADOS_NOTIFICACION.CANCELADA);
    });
  });
});
