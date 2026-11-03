import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { COLAS } from '../src/colas/colas.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import { ESTADOS_SOLICITUD } from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import {
  ConsultaSiiNoDisponible,
  ProveedorSituacionTributaria,
  type SituacionTributaria,
} from '../src/modulos/verificacion/sii/proveedor-situacion-tributaria.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
// El SII (Khipu) se reemplaza por un doble: la prueba no consulta RUT reales ni gasta cuota.

const CONTRASENA = 'Secreta123';
const PREFIJO_CORREO = 'e2e-solicitud-verificacion-';

const PELUQUERIA = {
  codigo: '960200',
  nombre: 'ACTIVIDADES DE PELUQUERIA Y OTROS TRATAMIENTOS DE BELLEZA',
  fechaInicio: '2020-01-15',
};
const OTRO_GIRO = {
  codigo: '471100',
  nombre: 'VENTA AL POR MENOR EN COMERCIOS NO ESPECIALIZADOS',
  fechaInicio: '2019-03-01',
};

/** Lo que responde el SII en la prueba; se cambia en cada caso. */
class ProveedorDePrueba extends ProveedorSituacionTributaria {
  readonly nombre = 'khipu';
  situacion: SituacionTributaria = {
    actividades: [PELUQUERIA],
    operacion: 'operacion-de-prueba',
  };
  falla = false;
  /** Cuánto tarda en responder (ms): sirve para que dos envíos se crucen. */
  demora = 0;
  readonly consultados: string[] = [];

  async consultar(rut: string): Promise<SituacionTributaria> {
    this.consultados.push(rut);
    if (this.demora > 0) {
      await new Promise((resolver) => setTimeout(resolver, this.demora));
    }
    if (this.falla) throw new ConsultaSiiNoDisponible('Khipu respondió 500.');
    return this.situacion;
  }

  reiniciar() {
    this.situacion = {
      actividades: [PELUQUERIA],
      operacion: 'operacion-de-prueba',
    };
    this.falla = false;
    this.demora = 0;
    this.consultados.length = 0;
  }
}

interface Solicitud {
  estado: string;
  fechaSolicitud: string;
  fechaResolucion: string | null;
  motivoRechazo: string | null;
  requiereDocumentos: boolean;
}

describe('Verificación · solicitar la verificación como profesional (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let contadorRut = 0;
  const proveedor = new ProveedorDePrueba();
  const correosCreados: string[] = [];

  const servidor = () => request(app.getHttpServer());

  /** Una cuenta con sesión iniciada; por defecto con RUT. */
  const cuenta = async (rol: Rol = ROLES.CLIENTE, conRut = true) => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    contadorRut += 1;
    const usuario = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Marcela',
        apellido: 'Soto',
        email,
        contrasenaHash: hashContrasena,
        rol,
        rut: conRut
          ? `${String(7_100_000 + contadorRut)}-${contadorRut % 10}`
          : null,
        fechaVerificacionCorreo: new Date(),
      },
    });
    const respuesta = await servidor()
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return {
      id: usuario.id,
      rut: usuario.rut,
      token: (respuesta.body as { tokenAcceso: string }).tokenAcceso,
    };
  };

  const solicitar = (token: string) =>
    servidor().post('/api/verificaciones').auth(token, { type: 'bearer' });

  const verMia = (token: string) =>
    servidor().get('/api/verificaciones/yo').auth(token, { type: 'bearer' });

  const solicitudesDe = (usuarioId: number) =>
    prisma.solicitudVerificacion.findMany({
      where: { solicitanteId: usuarioId },
      orderBy: { id: 'asc' },
    });

  const limpiar = async () => {
    // La aprobación automática encola el correo de E10-H4: se borran sus trabajos y notificaciones
    const correos = app.get<Queue>(getQueueToken(COLAS.CORREOS));
    const trabajos: Job<{ destinatario?: string }>[] = await correos.getJobs([
      'prioritized',
      'waiting',
      'delayed',
    ]);
    await Promise.all(
      trabajos
        .filter((t) => t.data?.destinatario?.startsWith(PREFIJO_CORREO))
        .map((t) => t.remove()),
    );
    await prisma.notificacion.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
    await prisma.solicitudVerificacion.deleteMany({
      where: { solicitante: { email: { startsWith: PREFIJO_CORREO } } },
    });
  };

  /** El límite por cuenta cuenta todos los envíos: se reinicia entre rondas de una prueba. */
  const reiniciarLimites = async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProveedorSituacionTributaria)
      .useValue(proveedor)
      .compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiar();
  });

  beforeEach(async () => {
    await reiniciarLimites();
    await limpiar();
    proveedor.reiniciar();
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  it('E10-H1 · aprobación automática: con el giro 960200 vigente la solicitud queda aprobada y guarda la consulta', async () => {
    const solicitante = await cuenta();

    const respuesta = await solicitar(solicitante.token).expect(201);

    const cuerpo = respuesta.body as Solicitud;
    expect(cuerpo).toMatchObject({
      estado: 'aprobada',
      motivoRechazo: null,
      requiereDocumentos: false,
    });
    expect(cuerpo.fechaResolucion).toEqual(expect.any(String));
    expect(proveedor.consultados).toEqual([solicitante.rut]);
    const [solicitud, ...otras] = await solicitudesDe(solicitante.id);
    expect(otras).toHaveLength(0);
    expect(solicitud).toMatchObject({
      estado: ESTADOS_SOLICITUD.APROBADA,
      resolutorId: null,
      puntajeConfianza: null,
      resultadoConsultaSii: 'aprobado',
      proveedorConsultaSii: 'khipu',
      operacionConsultaSii: 'operacion-de-prueba',
      girosSii: [PELUQUERIA],
    });
    expect(solicitud.fechaConsultaSii).toBeInstanceOf(Date);
    expect(solicitud.fechaResolucion).toBeInstanceOf(Date);
  });

  it('E10-H1 · sin inicio de actividades: no rechaza, queda pendiente, pide documentos y guarda el resultado', async () => {
    const solicitante = await cuenta();
    proveedor.situacion = { actividades: [], operacion: null };

    const respuesta = await solicitar(solicitante.token).expect(201);

    expect(respuesta.body).toMatchObject({
      estado: 'pendiente',
      fechaResolucion: null,
      requiereDocumentos: true,
    });
    const [solicitud] = await solicitudesDe(solicitante.id);
    expect(solicitud).toMatchObject({
      estado: 'pendiente',
      resultadoConsultaSii: 'sin_inicio_actividades',
      girosSii: [],
      fechaResolucion: null,
    });
  });

  it('E10-H1 · otro giro: no rechaza, queda pendiente, pide documentos y guarda los giros recibidos', async () => {
    const solicitante = await cuenta();
    proveedor.situacion = { actividades: [OTRO_GIRO], operacion: null };

    const respuesta = await solicitar(solicitante.token).expect(201);

    expect(respuesta.body).toMatchObject({
      estado: 'pendiente',
      requiereDocumentos: true,
    });
    const [solicitud] = await solicitudesDe(solicitante.id);
    expect(solicitud).toMatchObject({
      resultadoConsultaSii: 'otro_giro',
      girosSii: [OTRO_GIRO],
    });
  });

  it('E10-H1 · consulta no disponible: no bloquea al cliente, registra la falla y pide documentos', async () => {
    const solicitante = await cuenta();
    proveedor.falla = true;

    const respuesta = await solicitar(solicitante.token).expect(201);

    expect(respuesta.body).toMatchObject({
      estado: 'pendiente',
      requiereDocumentos: true,
    });
    const [solicitud] = await solicitudesDe(solicitante.id);
    expect(solicitud).toMatchObject({
      estado: 'pendiente',
      resultadoConsultaSii: 'no_disponible',
      proveedorConsultaSii: 'khipu',
      girosSii: null,
      operacionConsultaSii: null,
    });
    expect(solicitud.fechaConsultaSii).toBeInstanceOf(Date);
  });

  it('E10-H1 · lo que respondió el SII no sale: ni al solicitar ni al consultar el estado', async () => {
    const solicitante = await cuenta();

    const creada = await solicitar(solicitante.token).expect(201);
    const vista = await verMia(solicitante.token).expect(200);

    for (const cuerpo of [creada.body, vista.body]) {
      expect(Object.keys(cuerpo as object).sort()).toEqual([
        'documentos',
        'estado',
        'fechaResolucion',
        'fechaSolicitud',
        'motivoRechazo',
        'requiereDocumentos',
      ]);
      expect(JSON.stringify(cuerpo)).not.toMatch(
        /960200|giro|sii|khipu|operacion|puntaje|resolutor/i,
      );
    }
  });

  it('E10-H1 · cuenta sin RUT: responde 409 que pide registrarlo y no consulta ni guarda nada', async () => {
    const solicitante = await cuenta(ROLES.CLIENTE, false);

    const respuesta = await solicitar(solicitante.token).expect(409);

    expect((respuesta.body as { message: string }).message).toBe(
      'Registra tu RUT en tus datos antes de solicitar la verificación.',
    );
    expect(proveedor.consultados).toHaveLength(0);
    expect(await solicitudesDe(solicitante.id)).toHaveLength(0);
  });

  it('E10-H1 · nueva solicitud tras un rechazo: repite la consulta automática y es la que se ve', async () => {
    const solicitante = await cuenta();
    await prisma.solicitudVerificacion.create({
      data: {
        solicitanteId: solicitante.id,
        estado: ESTADOS_SOLICITUD.RECHAZADA,
        motivoRechazo: 'El documento no se lee.',
        fechaResolucion: new Date(),
      },
    });

    await solicitar(solicitante.token).expect(201);

    expect(proveedor.consultados).toEqual([solicitante.rut]);
    const solicitudes = await solicitudesDe(solicitante.id);
    expect(solicitudes.map((s) => s.estado)).toEqual(['rechazada', 'aprobada']);
    const vista = (await verMia(solicitante.token).expect(200))
      .body as Solicitud;
    expect(vista).toMatchObject({ estado: 'aprobada', motivoRechazo: null });
  });

  it('E10-H1 · solicitud en curso: pendiente o en revisión manual responde 409 sin consultar al SII', async () => {
    for (const estado of [
      ESTADOS_SOLICITUD.PENDIENTE,
      ESTADOS_SOLICITUD.REVISION_MANUAL,
    ]) {
      const solicitante = await cuenta();
      await prisma.solicitudVerificacion.create({
        data: { solicitanteId: solicitante.id, estado },
      });

      const respuesta = await solicitar(solicitante.token).expect(409);

      expect((respuesta.body as { message: string }).message).toBe(
        'Ya tienes una solicitud de verificación en curso.',
      );
      expect(await solicitudesDe(solicitante.id)).toHaveLength(1);
    }
    expect(proveedor.consultados).toHaveLength(0);
  });

  it('E10-H1 · solicitud ya aprobada o cuenta que ya es profesional: responde 409 sin consultar al SII', async () => {
    const aprobada = await cuenta();
    await prisma.solicitudVerificacion.create({
      data: {
        solicitanteId: aprobada.id,
        estado: ESTADOS_SOLICITUD.APROBADA,
        fechaResolucion: new Date(),
      },
    });
    const profesional = await cuenta(ROLES.PROFESIONAL);

    const conAprobada = await solicitar(aprobada.token).expect(409);
    const conRol = await solicitar(profesional.token).expect(409);

    expect((conAprobada.body as { message: string }).message).toBe(
      'Tu verificación ya fue aprobada.',
    );
    expect((conRol.body as { message: string }).message).toBe(
      'Tu cuenta ya es profesional.',
    );
    expect(proveedor.consultados).toHaveLength(0);
    expect(await solicitudesDe(profesional.id)).toHaveLength(0);
  });

  it('E10-H1 · dos envíos a la vez de la misma cuenta: queda una sola solicitud y el otro responde 409', async () => {
    const solicitante = await cuenta();
    proveedor.demora = 150;

    const respuestas = await Promise.all([
      solicitar(solicitante.token),
      solicitar(solicitante.token),
    ]);

    const estados = respuestas.map((r) => r.status).sort((a, b) => a - b);
    expect(estados).toEqual([201, 409]);
    expect(await solicitudesDe(solicitante.id)).toHaveLength(1);
  });

  it('E10-H1 · límite por cuenta: el sexto envío de la hora responde 429 y no afecta a otra cuenta', async () => {
    const solicitante = await cuenta(ROLES.CLIENTE, false);
    const otra = await cuenta(ROLES.CLIENTE, false);

    for (let intento = 0; intento < 5; intento += 1) {
      await solicitar(solicitante.token).expect(409);
    }
    await solicitar(solicitante.token).expect(429);
    await solicitar(otra.token).expect(409);
  });

  it('E10-H1 · el personal recibe 403 y sin sesión 401, al solicitar y al consultar', async () => {
    for (const rol of [ROLES.VENDEDOR, ROLES.BODEGUERO, ROLES.ADMINISTRADOR]) {
      const personal = await cuenta(rol);

      await solicitar(personal.token).expect(403);
      await verMia(personal.token).expect(403);
    }
    await servidor().post('/api/verificaciones').expect(401);
    await servidor().get('/api/verificaciones/yo').expect(401);
    expect(proveedor.consultados).toHaveLength(0);
  });

  describe('ver mi solicitud', () => {
    it('E10-H1 · solicitud rechazada: muestra el estado, el motivo y las fechas, y nunca el puntaje, las reglas ni quién la resolvió', async () => {
      const solicitante = await cuenta();
      const revisor = await cuenta(ROLES.ADMINISTRADOR);
      const solicitud = await prisma.solicitudVerificacion.create({
        data: {
          solicitanteId: solicitante.id,
          resolutorId: revisor.id,
          estado: ESTADOS_SOLICITUD.RECHAZADA,
          motivoRechazo: 'El documento no se lee.',
          fechaResolucion: new Date('2026-11-03T12:00:00.000Z'),
          puntajeConfianza: 41,
          versionReglas: 'v1',
          resultadoConsultaSii: 'otro_giro',
          girosSii: [OTRO_GIRO],
        },
      });

      const respuesta = await verMia(solicitante.token).expect(200);

      expect(respuesta.body).toEqual({
        estado: 'rechazada',
        fechaSolicitud: solicitud.fechaSolicitud.toISOString(),
        fechaResolucion: '2026-11-03T12:00:00.000Z',
        motivoRechazo: 'El documento no se lee.',
        requiereDocumentos: false,
        documentos: [],
      });
    });

    it('E10-H1 · con varias solicitudes muestra la más reciente; una cuenta sin solicitudes recibe 404 y nadie ve la de otra', async () => {
      const solicitante = await cuenta();
      const otra = await cuenta();
      await prisma.solicitudVerificacion.create({
        data: {
          solicitanteId: solicitante.id,
          estado: ESTADOS_SOLICITUD.RECHAZADA,
          motivoRechazo: 'Antigua.',
        },
      });
      await prisma.solicitudVerificacion.create({
        data: {
          solicitanteId: solicitante.id,
          estado: ESTADOS_SOLICITUD.REVISION_MANUAL,
          motivoRechazo: 'No debe salir.',
        },
      });

      const respuesta = await verMia(solicitante.token).expect(200);
      await verMia(otra.token).expect(404);

      expect(respuesta.body).toMatchObject({
        estado: 'revision_manual',
        motivoRechazo: null,
        requiereDocumentos: false,
      });
    });
  });
});
