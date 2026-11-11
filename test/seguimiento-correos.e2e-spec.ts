import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TRABAJOS_CORREO } from '../src/colas/colas.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import {
  ESTADOS_NOTIFICACION,
  ORIGENES_LEAD,
  TIPOS_CAMPANA,
  TIPOS_NOTIFICACION,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { FirmaSeguimiento } from '../src/modulos/marketing/firma-seguimiento.js';
import {
  CLIENTE_CORREO,
  type MensajeCorreo,
} from '../src/modulos/notificaciones/cliente-correo.js';
import { EnvioCorreosService } from '../src/modulos/notificaciones/envio-correos.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
// Resend se reemplaza por un doble que guarda los correos; sus avisos se firman aquí con el secreto
// de prueba, como lo hace Resend (Standard Webhooks).

// Antes de los imports: ConfigModule lee el entorno al importar AppModule
const { CLAVE_WEBHOOK, URL_API } = vi.hoisted(() => {
  const clave = Buffer.from('clave-del-webhook-e2e-de-32-bytes');
  const urlApi = 'https://api.e2e.cabelloperfecto.cl';
  process.env.RESEND_WEBHOOK_SECRET = `whsec_${clave.toString('base64')}`;
  process.env.URL_API = urlApi;
  return { CLAVE_WEBHOOK: clave, URL_API: urlApi };
});

const CONTRASENA = 'Secreta123';
const PREFIJO_CORREO = 'e2e-seguimiento-correos-';
const RUTA_SEGUIMIENTO = '/api/marketing/seguimiento';
const RUTA_REBOTES = '/api/marketing/rebotes';

/** Firma como Resend: HMAC-SHA256 de `id.marca.cuerpo` en las cabeceras `svix-*`. */
const firmarAviso = (cuerpo: string, clave = CLAVE_WEBHOOK) => {
  const id = `msg_${randomUUID()}`;
  const marca = String(Math.floor(Date.now() / 1000));
  const firma = createHmac('sha256', clave)
    .update(`${id}.${marca}.${cuerpo}`)
    .digest('base64');
  return {
    'svix-id': id,
    'svix-timestamp': marca,
    'svix-signature': `v1,${firma}`,
  };
};

const aviso = (tipo: string, to: string[], notificacionId?: number) =>
  JSON.stringify({
    type: tipo,
    created_at: new Date().toISOString(),
    data: {
      email_id: `re_${randomUUID()}`,
      to,
      subject: 'Ofertas de noviembre',
      ...(notificacionId === undefined
        ? {}
        : { tags: { notificacion: String(notificacionId) } }),
      bounce: { type: 'Permanent', subType: 'General', message: 'No existe' },
    },
  });

/** El tramo del token en una URL de seguimiento. */
const rutaDe = (enlace: string): string => {
  const url = new URL(enlace);
  return `${url.pathname}${url.search}`;
};

describe('Marketing · aperturas, clics y rebotes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let firma: FirmaSeguimiento;
  let envio: EnvioCorreosService;
  let hashContrasena: string;
  /** URL_TIENDA del entorno, sin la barra final. */
  let urlTienda: string;
  const enviados: MensajeCorreo[] = [];
  const correosCreados: string[] = [];

  const nuevoCorreo = () => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@correo.cl`;
    correosCreados.push(email);
    return email;
  };

  const crearCuenta = (rol: Rol, aceptaMarketingEmail = true) =>
    prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Camila',
        apellido: 'Rojas',
        email: nuevoCorreo(),
        contrasenaHash: hashContrasena,
        rol,
        aceptaMarketingEmail,
        fechaVerificacionCorreo: new Date(),
      },
      select: { id: true, email: true },
    });

  /** Un correo de campaña para la cuenta, pendiente o ya enviado. */
  const correoDeCampana = async (
    usuarioId: number,
    estadoEnvio: string = ESTADOS_NOTIFICACION.ENVIADA,
  ) => {
    const autor = await crearCuenta(ROLES.ADMINISTRADOR, false);
    const campana = await prisma.campana.create({
      data: {
        usuarioId: autor.id,
        tipo: TIPOS_CAMPANA.ENVIO_UNICO,
        asunto: 'Ofertas de noviembre',
        cuerpo: 'Llegó la línea reparadora.',
      },
      select: { id: true },
    });
    return prisma.notificacion.create({
      data: {
        usuarioId,
        campanaId: campana.id,
        tipo: TIPOS_NOTIFICACION.CAMPANA,
        asunto: 'Ofertas de noviembre',
        estadoEnvio,
      },
      select: { id: true },
    });
  };

  const leer = (id: number) =>
    prisma.notificacion.findUniqueOrThrow({
      where: { id },
      select: { estadoEnvio: true, fechaApertura: true, fechaClic: true },
    });

  const enviarAviso = (cuerpo: string, cabeceras = firmarAviso(cuerpo)) =>
    request(app.getHttpServer())
      .post(RUTA_REBOTES)
      .set('Content-Type', 'application/json')
      .set(cabeceras)
      .send(cuerpo);

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
    // Como main.ts: la firma de los avisos se calcula sobre el cuerpo tal como llegó
    app = configurarApp(modulo.createNestApplication({ rawBody: true }));
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    firma = app.get(FirmaSeguimiento);
    envio = app.get(EnvioCorreosService);
    hashContrasena = await argon2.hash(CONTRASENA);
    urlTienda = app
      .get(ConfigService)
      .get<string>('URL_TIENDA')!
      .replace(/\/+$/, '');
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
    await prisma.usuario.deleteMany({ where: { email } });
    await app.close();
  });

  describe('E12-H6 · CA1 apertura y clic', () => {
    it('E12-H6 · CA1 apertura y clic: el correo de campaña sale con la imagen de apertura y los enlaces por el seguimiento, y la etiqueta de su notificación', async () => {
      const cuenta = await crearCuenta(ROLES.CLIENTE);
      const { id } = await correoDeCampana(
        cuenta.id,
        ESTADOS_NOTIFICACION.PENDIENTE,
      );

      await envio.enviar(TRABAJOS_CORREO.CAMPANA, {
        notificacionId: id,
        destinatario: cuenta.email,
      });

      const correo = enviados.find((m) => m.notificacionId === id)!;
      expect(correo.html).toContain(
        `<img src="${URL_API}${RUTA_SEGUIMIENTO}/apertura/${id}.`,
      );
      // SCRUM-150: el pie no enlaza páginas que la tienda aún no tiene, así que la campaña (texto
      // plano) no lleva enlaces con seguimiento de clic
      expect(correo.html).not.toContain(`${URL_API}${RUTA_SEGUIMIENTO}/clic/`);
      // El correo para pedir la baja va sin seguimiento (SCRUM-19)
      expect(correo.html).toMatch(/href="mailto:[^"]+@[^"]+"/);
    });

    it('E12-H6 · CA1 apertura: guarda la fecha de la primera apertura y responde la imagen; abrir otra vez no la cambia', async () => {
      const cuenta = await crearCuenta(ROLES.CLIENTE);
      const { id } = await correoDeCampana(cuenta.id);
      const ruta = rutaDe(firma.enlaceApertura(id)!);

      const respuesta = await request(app.getHttpServer())
        .get(ruta)
        .expect(200)
        .expect('Content-Type', 'image/gif')
        .expect('Cache-Control', /no-store/);
      expect(respuesta.body).toBeInstanceOf(Buffer);
      const primera = (await leer(id)).fechaApertura;
      expect(primera).not.toBeNull();

      await request(app.getHttpServer()).get(ruta).expect(200);

      expect((await leer(id)).fechaApertura).toEqual(primera);
    });

    it('E12-H6 · CA1 clic: guarda la fecha del primer clic (y la apertura si faltaba) y redirige al destino; otro clic no la cambia', async () => {
      const cuenta = await crearCuenta(ROLES.CLIENTE);
      const { id } = await correoDeCampana(cuenta.id);
      const destino = `${urlTienda}/carrito`;
      const ruta = rutaDe(firma.enlaceClic(id, destino));

      await request(app.getHttpServer())
        .get(ruta)
        .expect(302)
        .expect('Location', destino);
      const primera = await leer(id);
      expect(primera.fechaClic).not.toBeNull();
      expect(primera.fechaApertura).not.toBeNull();

      await request(app.getHttpServer()).get(ruta).expect(302);

      expect((await leer(id)).fechaClic).toEqual(primera.fechaClic);
    });

    it('E12-H6 · CA1 enlace no válido: la imagen y la redirección responden igual, sin registrar nada, y nunca llevan a otro sitio', async () => {
      const cuenta = await crearCuenta(ROLES.CLIENTE);
      const { id } = await correoDeCampana(cuenta.id);
      const valida = rutaDe(firma.enlaceApertura(id)!);

      await request(app.getHttpServer())
        .get(valida.replace(`/apertura/${id}.`, `/apertura/${id + 1}.`))
        .expect(200)
        .expect('Content-Type', 'image/gif');
      await request(app.getHttpServer())
        .get(`${RUTA_SEGUIMIENTO}/clic/${id}.falsa?destino=https://otro.com`)
        .expect(302)
        .expect('Location', urlTienda);
      // Con una firma inválida tampoco lleva a una página de la tienda que no se firmó
      await request(app.getHttpServer())
        .get(
          `${RUTA_SEGUIMIENTO}/clic/${id}.falsa?destino=${encodeURIComponent(`${urlTienda}/carrito`)}`,
        )
        .expect(302)
        .expect('Location', urlTienda);

      const guardada = await leer(id);
      expect(guardada.fechaApertura).toBeNull();
      expect(guardada.fechaClic).toBeNull();
    });
  });

  describe('E12-H6 · CA2 correo rebotado', () => {
    it('E12-H6 · CA2 correo rebotado: marca el correo como rebotado y deja de enviar publicidad a esa dirección', async () => {
      const cuenta = await crearCuenta(ROLES.CLIENTE);
      const { id } = await correoDeCampana(cuenta.id);
      await prisma.lead.create({
        data: {
          email: cuenta.email,
          origen: ORIGENES_LEAD.FORMULARIO_WEB,
          activo: true,
        },
      });

      await enviarAviso(
        aviso('email.bounced', [cuenta.email.toUpperCase()], id),
      ).expect(200);

      expect((await leer(id)).estadoEnvio).toBe(ESTADOS_NOTIFICACION.REBOTADA);
      const guardada = await prisma.usuario.findUniqueOrThrow({
        where: { id: cuenta.id },
        select: { aceptaMarketingEmail: true },
      });
      expect(guardada.aceptaMarketingEmail).toBe(false);
      const lead = await prisma.lead.findUniqueOrThrow({
        where: { email: cuenta.email },
      });
      expect(lead.activo).toBe(false);
      expect(lead.fechaBaja).not.toBeNull();

      // La publicidad siguiente a esa dirección ya no sale
      const siguiente = await correoDeCampana(
        cuenta.id,
        ESTADOS_NOTIFICACION.PENDIENTE,
      );
      await envio.enviar(TRABAJOS_CORREO.CAMPANA, {
        notificacionId: siguiente.id,
        destinatario: cuenta.email,
      });
      expect((await leer(siguiente.id)).estadoEnvio).toBe(
        ESTADOS_NOTIFICACION.CANCELADA,
      );
      expect(enviados.some((m) => m.notificacionId === siguiente.id)).toBe(
        false,
      );
    });

    it('E12-H6 · CA2 correo rebotado de un suscriptor sin cuenta: queda rebotado y su suscripción se da de baja', async () => {
      const email = nuevoCorreo();
      const lead = await prisma.lead.create({
        data: { email, origen: ORIGENES_LEAD.FORMULARIO_WEB, activo: true },
        select: { id: true },
      });
      const autor = await crearCuenta(ROLES.ADMINISTRADOR, false);
      const campana = await prisma.campana.create({
        data: {
          usuarioId: autor.id,
          tipo: TIPOS_CAMPANA.ENVIO_UNICO,
          asunto: 'Ofertas de noviembre',
          cuerpo: 'Llegó la línea reparadora.',
        },
        select: { id: true },
      });
      const { id } = await prisma.notificacion.create({
        data: {
          leadId: lead.id,
          campanaId: campana.id,
          tipo: TIPOS_NOTIFICACION.CAMPANA,
          asunto: 'Ofertas de noviembre',
          estadoEnvio: ESTADOS_NOTIFICACION.ENVIADA,
        },
        select: { id: true },
      });

      await enviarAviso(aviso('email.bounced', [email], id)).expect(200);

      expect((await leer(id)).estadoEnvio).toBe(ESTADOS_NOTIFICACION.REBOTADA);
      const guardado = await prisma.lead.findUniqueOrThrow({
        where: { id: lead.id },
      });
      expect(guardado.activo).toBe(false);
      expect(guardado.fechaBaja).not.toBeNull();
    });

    it('E12-H6 · CA2 un aviso con la etiqueta de un correo de otra persona no lo marca como rebotado', async () => {
      const cuenta = await crearCuenta(ROLES.CLIENTE);
      const { id } = await correoDeCampana(cuenta.id);

      await enviarAviso(
        aviso('email.bounced', [`${PREFIJO_CORREO}otra@correo.cl`], id),
      ).expect(200);

      expect((await leer(id)).estadoEnvio).toBe(ESTADOS_NOTIFICACION.ENVIADA);
    });

    it('E12-H6 · CA2 el mismo aviso otra vez responde 200 y deja todo igual', async () => {
      const cuenta = await crearCuenta(ROLES.CLIENTE);
      const { id } = await correoDeCampana(cuenta.id);
      const cuerpo = aviso('email.bounced', [cuenta.email], id);

      await enviarAviso(cuerpo).expect(200);
      await enviarAviso(cuerpo).expect(200);

      expect((await leer(id)).estadoEnvio).toBe(ESTADOS_NOTIFICACION.REBOTADA);
    });

    it('E12-H6 · CA2 firma inválida o sin cabeceras: 401 y no toca nada', async () => {
      const cuenta = await crearCuenta(ROLES.CLIENTE);
      const { id } = await correoDeCampana(cuenta.id);
      const cuerpo = aviso('email.bounced', [cuenta.email], id);

      await enviarAviso(
        cuerpo,
        firmarAviso(cuerpo, Buffer.from('otra')),
      ).expect(401);
      await request(app.getHttpServer())
        .post(RUTA_REBOTES)
        .set('Content-Type', 'application/json')
        .send(cuerpo)
        .expect(401);

      expect((await leer(id)).estadoEnvio).toBe(ESTADOS_NOTIFICACION.ENVIADA);
      const guardada = await prisma.usuario.findUniqueOrThrow({
        where: { id: cuenta.id },
        select: { aceptaMarketingEmail: true },
      });
      expect(guardada.aceptaMarketingEmail).toBe(true);
    });

    it('E12-H6 · otros avisos de Resend responden 200 sin tocar nada', async () => {
      const cuenta = await crearCuenta(ROLES.CLIENTE);
      const { id } = await correoDeCampana(cuenta.id);

      await enviarAviso(aviso('email.delivered', [cuenta.email], id)).expect(
        200,
      );

      expect((await leer(id)).estadoEnvio).toBe(ESTADOS_NOTIFICACION.ENVIADA);
    });
  });
});
