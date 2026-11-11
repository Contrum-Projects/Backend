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
const RUTA_BAJA = '/api/marketing/bajas';

interface Consentimiento {
  acepta: boolean;
  fechaConsentimiento: string | null;
}

describe('Marketing · consentimiento de publicidad y baja desde el panel (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let tokenAdministrador: string;
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

  /** Baja desde el panel, con la sesión del administrador. */
  const darDeBaja = (email: unknown) =>
    request(app.getHttpServer())
      .post(RUTA_BAJA)
      .auth(tokenAdministrador, { type: 'bearer' })
      .send({ email });

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
    envio = app.get(EnvioCorreosService);
    hashContrasena = await argon2.hash(CONTRASENA);
    const administrador = await crearCuenta(ROLES.ADMINISTRADOR);
    tokenAdministrador = await iniciarSesion(administrador.email);
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

  describe('E12-H2 · la cuenta no se da de baja sola (decisión del 11 nov)', () => {
    it('E12-H2 · la ruta para que la cuenta desactive las ofertas ya no existe', async () => {
      const cuenta = await crearCuenta(ROLES.CLIENTE);
      const token = await iniciarSesion(cuenta.email);

      await request(app.getHttpServer())
        .put('/api/cuentas/yo/consentimiento-marketing')
        .auth(token, { type: 'bearer' })
        .send({ acepta: false })
        .expect(404);
    });

    it('E12-H2 · mis datos sigue mostrando el consentimiento de la cuenta', async () => {
      const cuenta = await crearCuenta(ROLES.CLIENTE);
      await prisma.usuario.update({
        where: { id: cuenta.id },
        data: {
          aceptaMarketingEmail: true,
          fechaConsentimientoMarketing: new Date('2026-10-01T00:00:00Z'),
        },
      });

      const token = await iniciarSesion(cuenta.email);
      const datos = await request(app.getHttpServer())
        .get('/api/cuentas/yo')
        .auth(token, { type: 'bearer' })
        .expect(200);

      expect(
        (datos.body as { consentimientoMarketing: Consentimiento })
          .consentimientoMarketing,
      ).toEqual({
        acepta: true,
        fechaConsentimiento: '2026-10-01T00:00:00.000Z',
      });
    });
  });

  describe('E12-H2 · baja desde el panel', () => {
    it('E12-H2 · baja desde el panel: deja de enviar publicidad a la dirección, sea de una cuenta o de un suscriptor, y la cuenta conserva la fecha del consentimiento', async () => {
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

      const respuesta = await darDeBaja(email.toUpperCase()).expect(200);

      expect(respuesta.body).toEqual({
        email,
        cuenta: true,
        suscripcion: true,
        mensaje: `Listo. ${email} ya no recibirá publicidad.`,
      });
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

    it('E12-H2 · baja desde el panel: repetirla responde lo mismo', async () => {
      const email = nuevoCorreo();
      await prisma.lead.create({
        data: { email, origen: ORIGENES_LEAD.FORMULARIO_WEB, activo: true },
      });

      const primera = await darDeBaja(email).expect(200);
      const segunda = await darDeBaja(email).expect(200);

      expect(segunda.body).toEqual(primera.body);
      expect(
        (await prisma.lead.findUniqueOrThrow({ where: { email } })).activo,
      ).toBe(false);
    });

    it('E12-H2 · baja desde el panel: tras una baja previa y una nueva suscripción pendiente, la baja invalida el enlace de confirmación anterior', async () => {
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

      await darDeBaja(email).expect(200);

      await request(app.getHttpServer())
        .post('/api/marketing/suscripciones/confirmar')
        .send({ token: confirmacion })
        .expect(400);
      expect(
        (await prisma.lead.findUniqueOrThrow({ where: { email } })).activo,
      ).toBe(false);
    });

    it('E12-H2 · baja desde el panel: un correo sin cuenta ni suscripción responde 404', async () => {
      await darDeBaja(`nadie-${randomUUID()}@prueba.cl`).expect(404);
    });

    it.each([[undefined], [''], ['no-es-correo']])(
      'E12-H2 · baja desde el panel: email=%s responde 400',
      async (email) => {
        await darDeBaja(email).expect(400);
      },
    );

    it('E12-H2 · RNF-03: sin sesión responde 401, y el vendedor y el cliente reciben 403', async () => {
      const email = nuevoCorreo();
      await request(app.getHttpServer())
        .post(RUTA_BAJA)
        .send({ email })
        .expect(401);

      for (const rol of [ROLES.VENDEDOR, ROLES.CLIENTE]) {
        const cuenta = await crearCuenta(rol);
        const token = await iniciarSesion(cuenta.email);
        await request(app.getHttpServer())
          .post(RUTA_BAJA)
          .auth(token, { type: 'bearer' })
          .send({ email })
          .expect(403);
      }
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

      await darDeBaja(email).expect(200);
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

    it('E12-H2 · baja con correos pendientes: la publicidad en cola para una cuenta dada de baja desde el panel queda cancelada', async () => {
      const cuenta = await crearCuenta(ROLES.CLIENTE);
      await prisma.usuario.update({
        where: { id: cuenta.id },
        data: {
          aceptaMarketingEmail: true,
          fechaConsentimientoMarketing: new Date(),
        },
      });
      const notificacion = await publicidadPendiente({ usuarioId: cuenta.id });

      await darDeBaja(cuenta.email).expect(200);
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
