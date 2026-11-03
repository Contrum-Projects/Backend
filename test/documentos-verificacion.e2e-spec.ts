import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AlmacenArchivos } from '../src/almacen/almacen-archivos.js';
import { AppModule } from '../src/app.module.js';
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
// R2 y el SII (Khipu) se reemplazan por dobles: la prueba no depende de Cloudflare ni de Khipu.

const CONTRASENA = 'Secreta123';
const PREFIJO_CORREO = 'e2e-documentos-verificacion-';
const MEGA = 1024 * 1024;

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

/** Almacén de prueba: guarda las claves en memoria y puede simular que R2 falla. */
class AlmacenDePrueba extends AlmacenArchivos {
  readonly archivos = new Map<string, { tipo: string; privado: boolean }>();
  fallarAlGuardar = false;

  guardar(
    clave: string,
    _contenido: Buffer,
    tipoContenido: string,
    privado = false,
  ) {
    if (this.fallarAlGuardar) {
      return Promise.reject(new Error('R2 no responde'));
    }
    this.archivos.set(clave, { tipo: tipoContenido, privado });
    return Promise.resolve();
  }

  eliminar(clave: string) {
    this.archivos.delete(clave);
    return Promise.resolve();
  }

  obtener(clave: string) {
    return Promise.reject(new Error(`${clave}: esta prueba no lee archivos`));
  }
}

/** Lo que responde el SII en la prueba; por defecto, un RUT sin el giro de peluquería. */
class ProveedorDePrueba extends ProveedorSituacionTributaria {
  readonly nombre = 'khipu';
  situacion: SituacionTributaria = {
    actividades: [OTRO_GIRO],
    operacion: null,
  };
  falla = false;

  consultar(): Promise<SituacionTributaria> {
    if (this.falla) {
      return Promise.reject(
        new ConsultaSiiNoDisponible('Khipu respondió 500.'),
      );
    }
    return Promise.resolve(this.situacion);
  }

  reiniciar() {
    this.situacion = { actividades: [OTRO_GIRO], operacion: null };
    this.falla = false;
  }
}

const pdf = (relleno = 2048) =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(relleno)]);
const jpg = (relleno = 2048) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(relleno)]);
const png = () =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(2048),
  ]);
const webp = () =>
  Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

interface DocumentoPrueba {
  buffer: Buffer;
  nombre: string;
  tipo: string;
}

interface Solicitud {
  estado: string;
  fechaResolucion: string | null;
  requiereDocumentos: boolean;
  documentos: { tipo: string; nombreArchivo: string }[];
}

describe('Verificación · adjuntar documentos para la revisión manual (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let almacen: AlmacenDePrueba;
  let hashContrasena: string;
  let contadorRut = 0;
  const proveedor = new ProveedorDePrueba();
  const correosCreados: string[] = [];

  const servidor = () => request(app.getHttpServer());

  const cuenta = async (rol: Rol = ROLES.CLIENTE) => {
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
        rut: `${String(7_300_000 + contadorRut)}-${contadorRut % 10}`,
        fechaVerificacionCorreo: new Date(),
      },
    });
    const respuesta = await servidor()
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return {
      id: usuario.id,
      token: (respuesta.body as { tokenAcceso: string }).tokenAcceso,
    };
  };

  /** Una cuenta que no pasó la verificación automática: su solicitud queda `pendiente`. */
  const cuentaPendiente = async () => {
    const solicitante = await cuenta();
    await servidor()
      .post('/api/verificaciones')
      .auth(solicitante.token, { type: 'bearer' })
      .expect(201);
    return solicitante;
  };

  const titulo = (nombre = 'titulo.pdf'): DocumentoPrueba => ({
    buffer: pdf(),
    nombre,
    tipo: 'titulo',
  });

  const adjuntar = (
    token: string,
    documentos: DocumentoPrueba[] = [titulo()],
    tiposAparte?: string[],
  ) => {
    let peticion = servidor()
      .post('/api/verificaciones/yo/documentos')
      .auth(token, { type: 'bearer' });
    for (const tipo of tiposAparte ?? documentos.map((d) => d.tipo)) {
      peticion = peticion.field('tipos', tipo);
    }
    for (const documento of documentos) {
      peticion = peticion.attach(
        'archivos',
        documento.buffer,
        documento.nombre,
      );
    }
    return peticion;
  };

  const verMia = (token: string) =>
    servidor().get('/api/verificaciones/yo').auth(token, { type: 'bearer' });

  const solicitudesDe = (usuarioId: number) =>
    prisma.solicitudVerificacion.findMany({
      where: { solicitanteId: usuarioId },
      include: { antecedentes: { orderBy: { id: 'asc' } } },
      orderBy: { id: 'asc' },
    });

  const limpiar = async () => {
    await prisma.solicitudVerificacion.deleteMany({
      where: { solicitante: { email: { startsWith: PREFIJO_CORREO } } },
    });
  };

  const reiniciarLimites = async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
  };

  beforeAll(async () => {
    almacen = new AlmacenDePrueba();
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AlmacenArchivos)
      .useValue(almacen)
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
    almacen.archivos.clear();
    almacen.fallarAlGuardar = false;
    proveedor.reiniciar();
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  it('E10-H2 · documentos enviados: la solicitud pasa a revisión manual, guarda los archivos privados con su hash y conserva el motivo', async () => {
    const solicitante = await cuentaPendiente();
    const certificado: DocumentoPrueba = {
      buffer: jpg(),
      nombre: 'certificado.jpg',
      tipo: 'certificado',
    };
    const otro: DocumentoPrueba = {
      buffer: png(),
      nombre: 'curso.png',
      tipo: 'otro',
    };
    const documentos = [titulo(), certificado, otro];

    const respuesta = await adjuntar(solicitante.token, documentos).expect(201);

    const cuerpo = respuesta.body as Solicitud;
    expect(cuerpo).toMatchObject({
      estado: 'revision_manual',
      fechaResolucion: null,
      requiereDocumentos: false,
      documentos: [
        { tipo: 'titulo', nombreArchivo: 'titulo.pdf' },
        { tipo: 'certificado', nombreArchivo: 'certificado.jpg' },
        { tipo: 'otro', nombreArchivo: 'curso.png' },
      ],
    });
    const [solicitud, ...otras] = await solicitudesDe(solicitante.id);
    expect(otras).toHaveLength(0);
    expect(solicitud).toMatchObject({
      estado: ESTADOS_SOLICITUD.REVISION_MANUAL,
      resolutorId: null,
      puntajeConfianza: null,
      // El motivo por el que se pidieron documentos (E10-H1) sigue en la solicitud
      resultadoConsultaSii: 'otro_giro',
    });
    expect(
      solicitud.antecedentes.map((a) => ({
        tipo: a.tipo,
        nombreArchivo: a.nombreArchivo,
        hashArchivo: a.hashArchivo,
        estadoOcr: a.estadoOcr,
        fechaEliminacionArchivo: a.fechaEliminacionArchivo,
      })),
    ).toEqual(
      documentos.map((documento) => ({
        tipo: documento.tipo,
        nombreArchivo: documento.nombre,
        hashArchivo: createHash('sha256')
          .update(documento.buffer)
          .digest('hex'),
        estadoOcr: 'no_aplica',
        fechaEliminacionArchivo: null,
      })),
    );
    expect(almacen.archivos.size).toBe(3);
    for (const antecedente of solicitud.antecedentes) {
      expect(antecedente.ubicacionArchivo).toMatch(
        new RegExp(`^verificaciones/${solicitante.id}/[0-9a-f-]{36}\\.`),
      );
      expect(almacen.archivos.get(antecedente.ubicacionArchivo)).toMatchObject({
        privado: true,
      });
    }
    expect([...almacen.archivos.values()].map((a) => a.tipo)).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
    ]);
    expect(JSON.stringify(cuerpo)).not.toMatch(
      /ubicacion|hash|verificaciones\/|sii|giro/i,
    );
  });

  it('E10-H2 · también se piden documentos cuando la consulta al SII no estaba disponible', async () => {
    proveedor.falla = true;
    const solicitante = await cuentaPendiente();

    await adjuntar(solicitante.token).expect(201);

    const [solicitud] = await solicitudesDe(solicitante.id);
    expect(solicitud).toMatchObject({
      estado: 'revision_manual',
      resultadoConsultaSii: 'no_disponible',
    });
  });

  it('E10-H2 · sin documentos: pide adjuntar al menos uno, no guarda nada y la solicitud sigue pendiente', async () => {
    const solicitante = await cuentaPendiente();

    await adjuntar(solicitante.token, []).expect(400);

    const [solicitud] = await solicitudesDe(solicitante.id);
    expect(solicitud).toMatchObject({ estado: 'pendiente' });
    expect(solicitud.antecedentes).toHaveLength(0);
    expect(almacen.archivos.size).toBe(0);
  });

  it('E10-H2 · solicitud aprobada automáticamente: no acepta documentos, responde 409 y no guarda nada', async () => {
    proveedor.situacion = { actividades: [PELUQUERIA], operacion: null };
    const solicitante = await cuenta();
    await servidor()
      .post('/api/verificaciones')
      .auth(solicitante.token, { type: 'bearer' })
      .expect(201);

    const respuesta = await adjuntar(solicitante.token).expect(409);

    expect((respuesta.body as { message: string }).message).toBe(
      'Tu verificación ya fue aprobada.',
    );
    const [solicitud] = await solicitudesDe(solicitante.id);
    expect(solicitud).toMatchObject({ estado: 'aprobada' });
    expect(solicitud.antecedentes).toHaveLength(0);
    expect(almacen.archivos.size).toBe(0);
  });

  it('E10-H2 · nueva solicitud tras un rechazo: sin pasar la verificación automática vuelve a aceptar documentos', async () => {
    const solicitante = await cuenta();
    await prisma.solicitudVerificacion.create({
      data: {
        solicitanteId: solicitante.id,
        estado: ESTADOS_SOLICITUD.RECHAZADA,
        motivoRechazo: 'El documento no se lee.',
        fechaResolucion: new Date(),
      },
    });

    // Con la solicitud rechazada no hay documentos que adjuntar: hay que solicitar de nuevo
    const rechazada = await adjuntar(solicitante.token).expect(409);
    expect((rechazada.body as { message: string }).message).toBe(
      'Tu solicitud fue rechazada. Envía una nueva solicitud de verificación.',
    );
    await servidor()
      .post('/api/verificaciones')
      .auth(solicitante.token, { type: 'bearer' })
      .expect(201);
    await adjuntar(solicitante.token).expect(201);

    const solicitudes = await solicitudesDe(solicitante.id);
    expect(solicitudes.map((s) => s.estado)).toEqual([
      'rechazada',
      'revision_manual',
    ]);
    expect(solicitudes[0].antecedentes).toHaveLength(0);
    expect(solicitudes[1].antecedentes).toHaveLength(1);
  });

  it('E10-H2 · documentos ya enviados: responde 409 y no guarda otros', async () => {
    const solicitante = await cuentaPendiente();
    await adjuntar(solicitante.token).expect(201);

    const respuesta = await adjuntar(solicitante.token, [
      titulo('otro.pdf'),
    ]).expect(409);

    expect((respuesta.body as { message: string }).message).toBe(
      'Ya enviaste tus documentos: el personal de la tienda los está revisando.',
    );
    expect(almacen.archivos.size).toBe(1);
    const [solicitud] = await solicitudesDe(solicitante.id);
    expect(solicitud.antecedentes).toHaveLength(1);
  });

  it('E10-H2 · cuenta sin solicitudes: responde 404', async () => {
    const solicitante = await cuenta();

    await adjuntar(solicitante.token).expect(404);

    expect(almacen.archivos.size).toBe(0);
  });

  it('E10-H2 · documentos inválidos: más de 5, un contenido que no es PDF, JPG ni PNG o tipos que no calzan responden 400 sin guardar nada', async () => {
    const solicitante = await cuentaPendiente();
    const falso: DocumentoPrueba = {
      buffer: Buffer.from('MZ ejecutable disfrazado'),
      nombre: 'titulo.pdf',
      tipo: 'titulo',
    };
    const enWebp: DocumentoPrueba = {
      buffer: webp(),
      nombre: 'foto.jpg',
      tipo: 'titulo',
    };

    await adjuntar(
      solicitante.token,
      Array.from({ length: 6 }, () => titulo()),
    ).expect(400);
    const noValido = await adjuntar(solicitante.token, [
      titulo(),
      falso,
    ]).expect(400);
    expect((noValido.body as { message: string }).message).toBe(
      'El documento 2 debe ser un PDF, JPG o PNG.',
    );
    await adjuntar(solicitante.token, [enWebp]).expect(400);
    await reiniciarLimites();
    await adjuntar(solicitante.token, [titulo(), titulo()], ['titulo']).expect(
      400,
    );
    await adjuntar(
      solicitante.token,
      [titulo()],
      ['titulo', 'certificado'],
    ).expect(400);

    const [solicitud] = await solicitudesDe(solicitante.id);
    expect(solicitud).toMatchObject({ estado: 'pendiente' });
    expect(solicitud.antecedentes).toHaveLength(0);
    expect(almacen.archivos.size).toBe(0);
  });

  it('E10-H2 · tipo de documento fuera de la lista: el carnet, el inicio de actividades y los inventados responden 400', async () => {
    const solicitante = await cuentaPendiente();

    for (const tipo of ['carnet', 'iniciacion_actividades', 'cedula', '']) {
      const respuesta = await adjuntar(
        solicitante.token,
        [titulo()],
        [tipo],
      ).expect(400);

      expect(JSON.stringify(respuesta.body)).toContain('certificado');
    }
    await adjuntar(solicitante.token, [titulo()], []).expect(400);
    expect(almacen.archivos.size).toBe(0);
  });

  it('E10-H2 · un documento de más de 5 MB responde 413 y no guarda nada', async () => {
    const solicitante = await cuentaPendiente();

    const respuesta = await adjuntar(solicitante.token, [
      { buffer: pdf(5 * MEGA), nombre: 'titulo.pdf', tipo: 'titulo' },
    ]).expect(413);

    expect((respuesta.body as { message: string }).message).toBe(
      'Cada documento puede pesar hasta 5 MB.',
    );
    expect(almacen.archivos.size).toBe(0);
    const [solicitud] = await solicitudesDe(solicitante.id);
    expect(solicitud).toMatchObject({ estado: 'pendiente' });
  });

  it('E10-H2 · el nombre del archivo conserva las tildes y no guarda la ruta del equipo', async () => {
    const solicitante = await cuentaPendiente();

    const respuesta = await adjuntar(solicitante.token, [
      titulo('C:\\Mis documentos\\Título profesional.pdf'),
    ]).expect(201);

    expect((respuesta.body as Solicitud).documentos).toEqual([
      { tipo: 'titulo', nombreArchivo: 'Título profesional.pdf' },
    ]);
  });

  it('E10-H2 · almacén caído: responde 503 sin detalles y la solicitud sigue pendiente', async () => {
    const solicitante = await cuentaPendiente();
    almacen.fallarAlGuardar = true;

    const respuesta = await adjuntar(solicitante.token).expect(503);

    expect(JSON.stringify(respuesta.body)).not.toContain('R2');
    const [solicitud] = await solicitudesDe(solicitante.id);
    expect(solicitud).toMatchObject({ estado: 'pendiente' });
    expect(solicitud.antecedentes).toHaveLength(0);
  });

  it('E10-H2 · dos envíos a la vez de la misma cuenta: uno queda en revisión, el otro responde 409 y sus archivos se borran', async () => {
    const solicitante = await cuentaPendiente();

    const respuestas = await Promise.all([
      adjuntar(solicitante.token),
      adjuntar(solicitante.token),
    ]);

    expect(respuestas.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    const [solicitud, ...otras] = await solicitudesDe(solicitante.id);
    expect(otras).toHaveLength(0);
    expect(solicitud.antecedentes).toHaveLength(1);
    expect([...almacen.archivos.keys()]).toEqual([
      solicitud.antecedentes[0].ubicacionArchivo,
    ]);
  });

  it('E10-H2 · límite por cuenta: el sexto envío de la hora responde 429 y no afecta a otra cuenta', async () => {
    const solicitante = await cuenta();
    const otra = await cuenta();

    for (let intento = 0; intento < 5; intento += 1) {
      await adjuntar(solicitante.token).expect(404);
    }
    await adjuntar(solicitante.token).expect(429);
    await adjuntar(otra.token).expect(404);
  });

  it('E10-H2 · el personal recibe 403 y sin sesión 401', async () => {
    for (const rol of [ROLES.VENDEDOR, ROLES.BODEGUERO, ROLES.ADMINISTRADOR]) {
      const personal = await cuenta(rol);

      await adjuntar(personal.token).expect(403);
    }
    await servidor().post('/api/verificaciones/yo/documentos').expect(401);
    expect(almacen.archivos.size).toBe(0);
  });

  it('E10-H2 · al consultar mi solicitud se ven los documentos que adjunté, sin su ubicación ni su hash', async () => {
    const solicitante = await cuentaPendiente();
    const antes = (await verMia(solicitante.token).expect(200))
      .body as Solicitud;
    await adjuntar(solicitante.token, [
      titulo(),
      { buffer: jpg(), nombre: 'certificado.jpg', tipo: 'certificado' },
    ]).expect(201);

    const despues = await verMia(solicitante.token).expect(200);

    expect(antes).toMatchObject({
      estado: 'pendiente',
      requiereDocumentos: true,
      documentos: [],
    });
    expect(despues.body).toMatchObject({
      estado: 'revision_manual',
      requiereDocumentos: false,
      documentos: [
        { tipo: 'titulo', nombreArchivo: 'titulo.pdf' },
        { tipo: 'certificado', nombreArchivo: 'certificado.jpg' },
      ],
    });
    expect(JSON.stringify(despues.body)).not.toMatch(
      /ubicacion|hash|verificaciones\//i,
    );
  });
});
