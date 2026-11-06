import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { COLAS, TRABAJOS_CUMPLEANOS } from '../src/colas/colas.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import {
  TIPOS_CAMPANA,
  TIPOS_NOTIFICACION,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { SaludosCumpleanosService } from '../src/modulos/marketing/saludos-cumpleanos.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
// La tarea se prueba llamando al servicio con la hora que tendría el reloj; los cumpleaños de
// prueba no son el de hoy, así la tarea programada real no los toca.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/marketing/cumpleanos';
const PREFIJO_CORREO = 'e2e-cumpleanos-';

/** Domingo 15 de marzo de 2026, 10:00 en Chile (UTC-3). */
const CUMPLEANOS = new Date('2026-03-15T13:00:00.000Z');
const NACIMIENTO = new Date('1990-03-15T00:00:00.000Z');

const SALUDO = {
  asunto: '¡Feliz cumpleaños!',
  cuerpo: 'Te deseamos un gran día.',
  oferta: { activa: true, texto: '20 % en toda la tienda esta semana.' },
};

interface Original {
  id: number;
  asunto: string;
  cuerpo: string;
  segmento: string | null;
}

describe('Marketing · saludo de cumpleaños (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let correos: Queue;
  let servicio: SaludosCumpleanosService;
  let hashContrasena: string;
  let tokenAdministrador: string;
  /** El saludo que ya existía en la base: se restaura al terminar. */
  let original: Original | null;

  const servidor = () => request(app.getHttpServer());

  const nuevaCuenta = async (
    rol: Rol,
    datos: { acepta?: boolean; fechaNacimiento?: Date | null } = {},
  ) => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    const usuario = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Camila',
        apellido: 'Rojas',
        email,
        contrasenaHash: hashContrasena,
        rol,
        fechaVerificacionCorreo: new Date(),
        aceptaMarketingEmail: datos.acepta ?? true,
        fechaNacimiento:
          datos.fechaNacimiento === undefined
            ? NACIMIENTO
            : datos.fechaNacimiento,
      },
    });
    return { id: usuario.id, email };
  };

  const tokenDe = async (rol: Rol) => {
    const { email } = await nuevaCuenta(rol, {
      acepta: false,
      fechaNacimiento: null,
    });
    const respuesta = await servidor()
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  const saludosDe = (usuarioId: number) =>
    prisma.notificacion.findMany({
      where: { usuarioId, tipo: TIPOS_NOTIFICACION.CUMPLEANOS },
      select: { id: true, campanaId: true, asunto: true },
    });

  const configurar = (cuerpo: object, token = tokenAdministrador) =>
    servidor().put(RUTA).auth(token, { type: 'bearer' }).send(cuerpo);

  const limpiar = async () => {
    const notificaciones = await prisma.notificacion.findMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
      select: { id: true },
    });
    // Los trabajos de la cola apuntan a estas notificaciones: no deben quedar para otras pruebas
    if (correos) {
      await Promise.all(
        notificaciones.map(({ id }) => correos.remove(`correo-${id}`)),
      );
    }
    await prisma.notificacion.deleteMany({
      where: { id: { in: notificaciones.map(({ id }) => id) } },
    });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    correos = app.get<Queue>(getQueueToken(COLAS.CORREOS));
    servicio = app.get(SaludosCumpleanosService);
    hashContrasena = await argon2.hash(CONTRASENA);
    original = await prisma.campana.findFirst({
      where: { tipo: TIPOS_CAMPANA.CUMPLEANOS },
      orderBy: { id: 'asc' },
      select: { id: true, asunto: true, cuerpo: true, segmento: true },
    });
    await limpiar();
    tokenAdministrador = await tokenDe(ROLES.ADMINISTRADOR);
  });

  afterAll(async () => {
    await limpiar();
    if (original) {
      const { id, ...datos } = original;
      await prisma.campana.update({ where: { id }, data: datos });
    } else {
      // La creó esta prueba: sus saludos ya se borraron con las cuentas de prueba
      await prisma.campana.deleteMany({
        where: { tipo: TIPOS_CAMPANA.CUMPLEANOS },
      });
    }
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: PREFIJO_CORREO } },
    });
    await app.close();
  });

  describe('permisos', () => {
    it.each([
      ['get', RUTA],
      ['put', RUTA],
    ] as const)('E12-H5 · %s %s sin sesión: 401', async (metodo, ruta) => {
      await servidor()[metodo](ruta).expect(401);
    });

    it.each([ROLES.CLIENTE, ROLES.VENDEDOR, ROLES.BODEGUERO])(
      'E12-H5 · %s no gestiona el saludo: 403',
      async (rol) => {
        const token = await tokenDe(rol);
        await servidor().get(RUTA).auth(token, { type: 'bearer' }).expect(403);
        await configurar(SALUDO, token).expect(403);
      },
    );
  });

  it('E12-H5 · CA2 saludo con oferta: el administrador activa la oferta y la consulta; guardar otra vez no crea otra fila', async () => {
    await configurar(SALUDO).expect(200);
    const respuesta = await configurar({
      ...SALUDO,
      cuerpo: 'Que tengas un gran día.',
    }).expect(200);

    expect(respuesta.body).toEqual({
      asunto: SALUDO.asunto,
      cuerpo: 'Que tengas un gran día.',
      oferta: SALUDO.oferta,
      configurado: true,
    });
    const consulta = await servidor()
      .get(RUTA)
      .auth(tokenAdministrador, { type: 'bearer' })
      .expect(200);
    expect(consulta.body).toEqual(respuesta.body);
    expect(
      await prisma.campana.count({
        where: { tipo: TIPOS_CAMPANA.CUMPLEANOS },
      }),
    ).toBe(1);
  });

  it.each([
    ['oferta activa sin texto', { ...SALUDO, oferta: { activa: true } }],
    ['sin oferta', { asunto: SALUDO.asunto, cuerpo: SALUDO.cuerpo }],
    [
      'oferta sin activa',
      { ...SALUDO, oferta: { texto: SALUDO.oferta.texto } },
    ],
    ['asunto de varias líneas', { ...SALUDO, asunto: 'Hola\nBcc: x@y.cl' }],
    ['saludo vacío', { ...SALUDO, cuerpo: '   ' }],
    ['campo de más', { ...SALUDO, descuento: 20 }],
  ])(
    'E12-H5 · CA2 saludo con oferta: %s responde 400',
    async (_caso, cuerpo) => {
      await configurar(cuerpo).expect(400);
    },
  );

  it('E12-H5 · CA1 saludo enviado · CA2 saludo con oferta: el día del cumpleaños crea un saludo con la campaña configurada, una sola vez en el año', async () => {
    await configurar(SALUDO).expect(200);
    const campana = await prisma.campana.findFirstOrThrow({
      where: { tipo: TIPOS_CAMPANA.CUMPLEANOS },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    const cliente = await nuevaCuenta(ROLES.CLIENTE);
    const profesional = await nuevaCuenta(ROLES.PROFESIONAL);

    await servicio.enviarSaludos(CUMPLEANOS);
    // Otra pasada el mismo día y otra más tarde en el año no lo repiten
    await servicio.enviarSaludos(CUMPLEANOS);
    await servicio.enviarSaludos(new Date('2026-03-15T23:00:00.000Z'));

    for (const cuenta of [cliente, profesional]) {
      expect(await saludosDe(cuenta.id)).toEqual([
        {
          id: expect.any(Number) as number,
          campanaId: campana.id,
          asunto: SALUDO.asunto,
        },
      ]);
    }
  });

  it('E12-H5 · CA1 saludo enviado: antes de las 9:00 de Chile o en otro día no se saluda', async () => {
    const cuenta = await nuevaCuenta(ROLES.CLIENTE);

    // 8:59 del cumpleaños en Chile
    await servicio.enviarSaludos(new Date('2026-03-15T11:59:00.000Z'));
    // Al día siguiente
    await servicio.enviarSaludos(new Date('2026-03-16T13:00:00.000Z'));

    expect(await saludosDe(cuenta.id)).toEqual([]);
  });

  it('E12-H5 · nacido un 29 de febrero: en un año no bisiesto se saluda el 28 de febrero', async () => {
    const cuenta = await nuevaCuenta(ROLES.CLIENTE, {
      fechaNacimiento: new Date('2000-02-29T00:00:00.000Z'),
    });

    // Domingo 28 de febrero de 2027, 12:00 en Chile
    await servicio.enviarSaludos(new Date('2027-02-28T15:00:00.000Z'));

    expect(await saludosDe(cuenta.id)).toHaveLength(1);
  });

  it('E12-H5 · CA3 sin fecha o sin consentimiento: sin fecha de nacimiento, sin aceptar publicidad o del personal no recibe el saludo', async () => {
    const cuentas = await Promise.all([
      nuevaCuenta(ROLES.CLIENTE, { fechaNacimiento: null }),
      nuevaCuenta(ROLES.CLIENTE, { acepta: false }),
      nuevaCuenta(ROLES.VENDEDOR),
    ]);

    await servicio.enviarSaludos(CUMPLEANOS);

    for (const cuenta of cuentas) {
      expect(await saludosDe(cuenta.id)).toEqual([]);
    }
  });

  it('RNF-29 · Redis vuelve sin sus datos: al reconectar crea de nuevo la tarea de cumpleaños', async () => {
    const cola = app.get<Queue>(getQueueToken(COLAS.CUMPLEANOS));
    const tarea = TRABAJOS_CUMPLEANOS.SALUDAR;
    await cola.removeJobScheduler(tarea);
    expect(await cola.getJobScheduler(tarea)).toBeUndefined();

    (await cola.getBackend().client).disconnect(true);

    await vi.waitFor(
      async () => expect(await cola.getJobScheduler(tarea)).toBeDefined(),
      { timeout: 10_000, interval: 100 },
    );
  }, 15_000);
});
