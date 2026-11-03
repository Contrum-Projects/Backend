import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AlmacenArchivos } from '../src/almacen/almacen-archivos.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import { ESTADOS_SOLICITUD } from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
// Las solicitudes y sus documentos se crean directo en la base: cómo llegan a revisión manual es de
// E10-H1 y E10-H2, que tienen sus propias pruebas.

const CONTRASENA = 'Secreta123';
const PREFIJO_CORREO = 'e2e-consulta-verificacion-';
const GIROS = [
  {
    codigo: '471100',
    nombre: 'VENTA AL POR MENOR EN COMERCIOS NO ESPECIALIZADOS',
    fechaInicio: '2019-03-01',
  },
];

/** Almacén de prueba: el «enlace firmado» deja ver qué clave y qué plazo se pidieron. */
class AlmacenDePrueba extends AlmacenArchivos {
  guardar() {
    return Promise.reject(new Error('esta prueba no guarda archivos'));
  }

  eliminar() {
    return Promise.resolve();
  }

  obtener() {
    return Promise.reject(new Error('esta prueba no lee archivos'));
  }

  urlTemporal(
    clave: string,
    opciones: { segundos: number; nombreArchivo?: string },
  ) {
    const nombre = encodeURIComponent(opciones.nombreArchivo ?? '');
    return Promise.resolve(
      `https://almacen.prueba/${clave}?expira=${opciones.segundos}&nombre=${nombre}`,
    );
  }
}

interface ItemListado {
  codigoPublicoCuenta: string;
  nombre: string;
  apellido: string;
  rut: string | null;
  fechaEnvio: string;
  motivoRevision: string | null;
}

describe('Verificación · listar solicitudes en revisión manual y ver su detalle (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let contadorRut = 0;
  const correosCreados: string[] = [];

  const servidor = () => request(app.getHttpServer());

  const con = (token: string | null, peticion: request.Test) =>
    token ? peticion.auth(token, { type: 'bearer' }) : peticion;

  const listar = (token: string | null, consulta = '') =>
    con(
      token,
      servidor().get(`/api/verificaciones/revision-manual${consulta}`),
    );

  const detalle = (token: string | null, codigo: string) =>
    con(token, servidor().get(`/api/verificaciones/${codigo}`));

  const documento = (token: string | null, codigo: string, numero: string) =>
    con(
      token,
      servidor().get(`/api/verificaciones/${codigo}/documentos/${numero}`),
    );

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
        rut: `${String(8_100_000 + contadorRut)}-${contadorRut % 10}`,
        telefono: '+56911112222',
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
      email,
      rut: usuario.rut,
      token: (respuesta.body as { tokenAcceso: string }).tokenAcceso,
    };
  };

  const solicitud = (
    solicitanteId: number,
    datos: Partial<{
      estado: string;
      fechaSolicitud: Date;
      resultadoConsultaSii: string | null;
      resolutorId: number;
      motivoRechazo: string;
      fechaResolucion: Date;
      /** La consulta al SII falló: no hay giros que guardar. */
      sinGiros: boolean;
    }> = {},
  ) => {
    const { sinGiros, ...resto } = datos;
    return prisma.solicitudVerificacion.create({
      data: {
        solicitanteId,
        estado: ESTADOS_SOLICITUD.REVISION_MANUAL,
        fechaConsultaSii: new Date('2026-11-02T18:00:01.000Z'),
        resultadoConsultaSii: 'otro_giro',
        ...(sinGiros ? {} : { girosSii: GIROS }),
        ...resto,
      },
    });
  };

  const adjunto = (
    solicitudId: number,
    nombreArchivo: string,
    tipo = 'titulo',
    fechaEliminacionArchivo: Date | null = null,
  ) =>
    prisma.antecedente.create({
      data: {
        solicitudId,
        tipo,
        nombreArchivo,
        ubicacionArchivo: `verificaciones/${solicitudId}/${randomUUID()}.pdf`,
        hashArchivo: 'a'.repeat(64),
        estadoOcr: 'no_aplica',
        fechaEliminacionArchivo,
      },
    });

  const limpiar = async () => {
    await prisma.solicitudVerificacion.deleteMany({
      where: { solicitante: { email: { startsWith: PREFIJO_CORREO } } },
    });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AlmacenArchivos)
      .useValue(new AlmacenDePrueba())
      .compile();
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

  it('E10-H7 · listado: devuelve solo las solicitudes en revisión manual, de la más antigua a la más reciente, con nombre, RUT, fecha y motivo', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    const reciente = await cuenta();
    const antigua = await cuenta();
    const sinSii = await cuenta();
    const pendiente = await cuenta();
    const aprobada = await cuenta();
    await solicitud(reciente.id, {
      fechaSolicitud: new Date('2026-11-03T12:00:00.000Z'),
      resultadoConsultaSii: 'sin_inicio_actividades',
    });
    await solicitud(antigua.id, {
      fechaSolicitud: new Date('2026-11-01T12:00:00.000Z'),
    });
    await solicitud(sinSii.id, {
      fechaSolicitud: new Date('2026-11-02T12:00:00.000Z'),
      resultadoConsultaSii: 'no_disponible',
    });
    await solicitud(pendiente.id, { estado: ESTADOS_SOLICITUD.PENDIENTE });
    await solicitud(aprobada.id, { estado: ESTADOS_SOLICITUD.APROBADA });

    const respuesta = await listar(administrador.token, '?limite=100').expect(
      200,
    );

    const cuerpo = respuesta.body as {
      items: ItemListado[];
      total: number;
      pagina: number;
      limite: number;
    };
    const propios = cuerpo.items.filter((item) =>
      [reciente, antigua, sinSii, pendiente, aprobada].some(
        (c) => c.codigoPublico === item.codigoPublicoCuenta,
      ),
    );
    expect(propios).toEqual([
      {
        codigoPublicoCuenta: antigua.codigoPublico,
        nombre: 'Marcela',
        apellido: 'Soto',
        rut: antigua.rut,
        fechaEnvio: '2026-11-01T12:00:00.000Z',
        motivoRevision: 'otro_giro',
      },
      expect.objectContaining({
        codigoPublicoCuenta: sinSii.codigoPublico,
        fechaEnvio: '2026-11-02T12:00:00.000Z',
        motivoRevision: 'no_disponible',
      }),
      expect.objectContaining({
        codigoPublicoCuenta: reciente.codigoPublico,
        fechaEnvio: '2026-11-03T12:00:00.000Z',
        motivoRevision: 'sin_inicio_actividades',
      }),
    ]);
    expect(cuerpo.total).toBeGreaterThanOrEqual(3);
    expect(cuerpo).toMatchObject({ pagina: 1, limite: 100 });
  });

  it('E10-H7 · listado paginado: respeta la página y el límite, y rechaza una paginación inválida', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    for (const dia of [1, 2, 3]) {
      const cliente = await cuenta();
      await solicitud(cliente.id, {
        fechaSolicitud: new Date(`2026-11-0${dia}T12:00:00.000Z`),
      });
    }

    const primera = await listar(administrador.token, '?pagina=1&limite=1');
    const segunda = await listar(administrador.token, '?pagina=2&limite=1');

    const a = primera.body as { items: ItemListado[]; total: number };
    const b = segunda.body as { items: ItemListado[]; total: number };
    expect(primera.status).toBe(200);
    expect(a.items).toHaveLength(1);
    expect(b.items).toHaveLength(1);
    expect(a.items[0].codigoPublicoCuenta).not.toBe(
      b.items[0].codigoPublicoCuenta,
    );
    expect(a.items[0].fechaEnvio <= b.items[0].fechaEnvio).toBe(true);
    expect(a.total).toBe(b.total);

    await listar(administrador.token, '?pagina=0').expect(400);
    await listar(administrador.token, '?limite=101').expect(400);
  });

  it('E10-H7 · detalle: datos del cliente, motivo, resultado del SII con sus giros, documentos y las solicitudes anteriores con su resolución', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    const cliente = await cuenta();
    const anterior = await solicitud(cliente.id, {
      estado: ESTADOS_SOLICITUD.RECHAZADA,
      fechaSolicitud: new Date('2026-10-20T12:00:00.000Z'),
      resultadoConsultaSii: 'sin_inicio_actividades',
      resolutorId: administrador.id,
      motivoRechazo: 'El certificado adjunto no es legible.',
      fechaResolucion: new Date('2026-10-21T12:00:00.000Z'),
    });
    await adjunto(anterior.id, 'viejo.pdf');
    const actual = await solicitud(cliente.id, {
      fechaSolicitud: new Date('2026-11-02T18:00:00.000Z'),
    });
    await adjunto(actual.id, 'título.pdf', 'titulo');
    await adjunto(actual.id, 'certificado.pdf', 'certificado');

    const respuesta = await detalle(
      administrador.token,
      cliente.codigoPublico,
    ).expect(200);

    expect(respuesta.body).toEqual({
      cliente: {
        codigoPublico: cliente.codigoPublico,
        nombre: 'Marcela',
        apellido: 'Soto',
        rut: cliente.rut,
        email: cliente.email,
        telefono: '+56911112222',
      },
      solicitud: {
        estado: 'revision_manual',
        fechaSolicitud: '2026-11-02T18:00:00.000Z',
        fechaResolucion: null,
        motivoRechazo: null,
        resolutor: null,
        motivoRevision: 'otro_giro',
        consultaSii: {
          fecha: '2026-11-02T18:00:01.000Z',
          resultado: 'otro_giro',
          giros: GIROS,
        },
        documentos: [
          {
            numero: 1,
            tipo: 'titulo',
            nombreArchivo: 'título.pdf',
            fechaEliminacion: null,
          },
          {
            numero: 2,
            tipo: 'certificado',
            nombreArchivo: 'certificado.pdf',
            fechaEliminacion: null,
          },
        ],
      },
      solicitudesAnteriores: [
        {
          estado: 'rechazada',
          fechaSolicitud: '2026-10-20T12:00:00.000Z',
          fechaResolucion: '2026-10-21T12:00:00.000Z',
          motivoRechazo: 'El certificado adjunto no es legible.',
          resolutor: {
            codigoPublico: administrador.codigoPublico,
            nombre: 'Marcela',
            apellido: 'Soto',
          },
        },
      ],
    });
    // Ni la ubicación de los archivos ni su hash salen de la API
    expect(JSON.stringify(respuesta.body)).not.toContain('verificaciones/');
    expect(JSON.stringify(respuesta.body)).not.toContain('aaaaaaaa');
  });

  it('E10-H7 · detalle: si la consulta al SII falló, el resultado es no disponible y no trae giros', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    const cliente = await cuenta();
    await solicitud(cliente.id, {
      resultadoConsultaSii: 'no_disponible',
      estado: ESTADOS_SOLICITUD.PENDIENTE,
      sinGiros: true,
    });

    const respuesta = await detalle(
      administrador.token,
      cliente.codigoPublico,
    ).expect(200);

    expect(respuesta.body).toMatchObject({
      solicitud: {
        estado: 'pendiente',
        motivoRevision: 'no_disponible',
        consultaSii: {
          resultado: 'no_disponible',
          giros: null,
        },
        documentos: [],
      },
      solicitudesAnteriores: [],
    });
  });

  it('E10-H7 · documento: entrega un enlace temporal de 60 segundos al archivo, con su nombre', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    const cliente = await cuenta();
    const actual = await solicitud(cliente.id);
    const primero = await adjunto(actual.id, 'título.pdf', 'titulo');
    const segundo = await adjunto(actual.id, 'certificado.pdf', 'certificado');
    const antes = Date.now();

    const respuesta = await documento(
      administrador.token,
      cliente.codigoPublico,
      '2',
    ).expect(200);

    const cuerpo = respuesta.body as {
      url: string;
      venceEn: string;
      tipo: string;
      nombreArchivo: string;
    };
    expect(cuerpo.url).toBe(
      `https://almacen.prueba/${segundo.ubicacionArchivo}?expira=60&nombre=certificado.pdf`,
    );
    expect(cuerpo.url).not.toContain(primero.ubicacionArchivo);
    expect(cuerpo.tipo).toBe('certificado');
    expect(cuerpo.nombreArchivo).toBe('certificado.pdf');
    expect(new Date(cuerpo.venceEn).getTime()).toBeGreaterThanOrEqual(
      antes + 59_000,
    );
    expect(new Date(cuerpo.venceEn).getTime()).toBeLessThanOrEqual(
      Date.now() + 61_000,
    );
  });

  it('E10-H7 · documento eliminado: el detalle indica la fecha de eliminación y el enlace responde 410 sin entregar nada', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    const cliente = await cuenta();
    const actual = await solicitud(cliente.id, {
      estado: ESTADOS_SOLICITUD.APROBADA,
      resolutorId: administrador.id,
      fechaResolucion: new Date('2026-11-02T20:00:00.000Z'),
    });
    await adjunto(
      actual.id,
      'título.pdf',
      'titulo',
      new Date('2026-12-02T12:00:00.000Z'),
    );

    const vista = await detalle(
      administrador.token,
      cliente.codigoPublico,
    ).expect(200);
    const enlace = await documento(
      administrador.token,
      cliente.codigoPublico,
      '1',
    ).expect(410);

    expect(vista.body).toMatchObject({
      solicitud: {
        documentos: [
          {
            numero: 1,
            nombreArchivo: 'título.pdf',
            fechaEliminacion: '2026-12-02T12:00:00.000Z',
          },
        ],
      },
    });
    expect(JSON.stringify(enlace.body)).toContain(
      'El documento se eliminó el 02-12-2026.',
    );
    expect(JSON.stringify(enlace.body)).not.toContain('almacen.prueba');
  });

  it('E10-H7 · documento: un número que no existe responde 404 y uno que no es número, 400', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    const cliente = await cuenta();
    const actual = await solicitud(cliente.id);
    await adjunto(actual.id, 'título.pdf');

    for (const numero of ['0', '-1', '2', '999']) {
      await documento(
        administrador.token,
        cliente.codigoPublico,
        numero,
      ).expect(404);
    }
    await documento(administrador.token, cliente.codigoPublico, 'uno').expect(
      400,
    );
    await documento(administrador.token, cliente.codigoPublico, '1.5').expect(
      400,
    );
  });

  it('E10-H7 · cuenta sin solicitudes, que no existe o con un código inválido: detalle y documento responden 404 o 400', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    const sinSolicitud = await cuenta();

    await detalle(administrador.token, sinSolicitud.codigoPublico).expect(404);
    await documento(
      administrador.token,
      sinSolicitud.codigoPublico,
      '1',
    ).expect(404);
    await detalle(administrador.token, randomUUID()).expect(404);
    await detalle(administrador.token, 'no-es-un-uuid').expect(400);
    await documento(administrador.token, 'no-es-un-uuid', '1').expect(400);
  });

  it('RNF-03 · sin sesión 401; cliente, profesional, vendedor y bodeguero 403 en el listado, el detalle y el documento', async () => {
    const cliente = await cuenta();
    const actual = await solicitud(cliente.id);
    await adjunto(actual.id, 'título.pdf');

    await listar(null).expect(401);
    await detalle(null, cliente.codigoPublico).expect(401);
    await documento(null, cliente.codigoPublico, '1').expect(401);
    for (const rol of [
      ROLES.CLIENTE,
      ROLES.PROFESIONAL,
      ROLES.VENDEDOR,
      ROLES.BODEGUERO,
    ]) {
      const otra = await cuenta(rol);
      await listar(otra.token).expect(403);
      await detalle(otra.token, cliente.codigoPublico).expect(403);
      await documento(otra.token, cliente.codigoPublico, '1').expect(403);
    }
    // Ni siquiera quien solicitó ve su propio detalle por esta ruta
    await detalle(cliente.token, cliente.codigoPublico).expect(403);
    await documento(cliente.token, cliente.codigoPublico, '1').expect(403);
  });

  it('E10-H7 · GET /verificaciones/yo sigue siendo la ruta de quien solicita: no la captura el detalle del personal', async () => {
    const cliente = await cuenta();
    await solicitud(cliente.id, { estado: ESTADOS_SOLICITUD.PENDIENTE });

    const mia = await con(
      cliente.token,
      servidor().get('/api/verificaciones/yo'),
    ).expect(200);

    expect(mia.body).toMatchObject({
      estado: 'pendiente',
      requiereDocumentos: true,
    });
  });
});
