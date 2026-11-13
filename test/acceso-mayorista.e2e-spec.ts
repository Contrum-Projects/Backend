import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoVerificacionAprobada,
} from '../src/colas/colas.js';
import { precioConIva } from '../src/common/dominio/montos.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import {
  CANALES_VENTA,
  ESTADOS_NOTIFICACION,
  ESTADOS_SOLICITUD,
  ORIGENES_DESCRIPCION,
  TIPOS_ARTICULO,
  TIPOS_NOTIFICACION,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import {
  ProveedorSituacionTributaria,
  type SituacionTributaria,
} from '../src/modulos/verificacion/sii/proveedor-situacion-tributaria.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
// El SII (Khipu) se reemplaza por un doble que responde con el giro de peluquería vigente. El worker
// de correos está apagado en los e2e: el correo se lee desde la cola.

const CONTRASENA = 'Secreta123';
const PREFIJO_CORREO = 'e2e-acceso-mayorista-';
const PREFIJO = 'E2E-acceso-mayorista';
const MAYORISTA_NETO = 8000;
const MINORISTA_NETO = 10000;

class ProveedorPeluqueria extends ProveedorSituacionTributaria {
  readonly nombre = 'khipu';
  consultar(): Promise<SituacionTributaria> {
    return Promise.resolve({
      actividades: [
        {
          codigo: '960200',
          nombre: 'ACTIVIDADES DE PELUQUERIA Y OTROS TRATAMIENTOS DE BELLEZA',
          fechaInicio: '2020-01-15',
        },
      ],
      contribuyente: 'SOTO PEREZ ANDREA',
      operacion: 'operacion-de-prueba',
    });
  }
}

interface Sesion {
  id: number;
  email: string;
  codigoPublico: string;
  token: string;
  /** Cookie `refresco=...` para renovar la sesión. */
  cookie: string;
}

interface FormatoDetalle {
  precio: number | null;
  precioMayorista?: number;
}

describe('Verificación · acceso inmediato al precio mayorista y aviso por correo (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let correos: Queue;
  let hashContrasena: string;
  let porcentajeIva: number;
  let productoId: number;
  let contadorRut = 0;
  const correosCreados: string[] = [];

  const servidor = () => request(app.getHttpServer());

  const cuenta = async (rol: Rol = ROLES.CLIENTE): Promise<Sesion> => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    contadorRut += 1;
    const usuario = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Andrea',
        apellido: 'Soto',
        email,
        contrasenaHash: hashContrasena,
        rol,
        rut: `${String(7_200_000 + contadorRut)}-${contadorRut % 10}`,
        fechaVerificacionCorreo: new Date(),
      },
    });
    const respuesta = await servidor()
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    const cookie = ([] as string[])
      .concat(respuesta.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('refresco='))!
      .split(';')[0];
    return {
      id: usuario.id,
      email,
      codigoPublico: usuario.codigoPublico,
      token: (respuesta.body as { tokenAcceso: string }).tokenAcceso,
      cookie,
    };
  };

  /** Lo que el frontend hace tras la aprobación: renueva la sesión y toma el rol de la base. */
  const renovar = async (sesion: Sesion) => {
    const respuesta = await servidor()
      .post('/api/cuentas/sesion/renovar')
      .set('Cookie', sesion.cookie)
      .expect(200);
    return respuesta.body as { tokenAcceso: string; usuario: { rol: string } };
  };

  const formatoVisto = async (token: string): Promise<FormatoDetalle> => {
    const respuesta = await servidor()
      .get(`/api/tienda/productos/${productoId}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    return (respuesta.body as { formatos: FormatoDetalle[] }).formatos[0];
  };

  const trabajosDe = async (email: string) => {
    const trabajos: Job<TrabajoVerificacionAprobada>[] = await correos.getJobs([
      'prioritized',
      'waiting',
      'delayed',
    ]);
    return trabajos.filter((t) => t.data?.destinatario === email);
  };

  const notificacionesDe = (usuarioId: number) =>
    prisma.notificacion.findMany({
      where: { usuarioId, tipo: TIPOS_NOTIFICACION.VERIFICACION_APROBADA },
    });

  /** El rol cambió, el token renovado lo trae y el catálogo ya muestra el precio mayorista. */
  const esperarAccesoMayorista = async (sesion: Sesion) => {
    const guardada = await prisma.usuario.findUniqueOrThrow({
      where: { id: sesion.id },
    });
    expect(guardada.rol).toBe(ROLES.PROFESIONAL);

    // La sesión abierta no se revoca: el token anterior sigue siendo válido (con permisos de cliente)
    await servidor()
      .get('/api/cuentas/yo')
      .auth(sesion.token, { type: 'bearer' })
      .expect(200);

    const renovada = await renovar(sesion);
    expect(renovada.usuario.rol).toBe(ROLES.PROFESIONAL);
    expect(await formatoVisto(renovada.tokenAcceso)).toMatchObject({
      precioMayorista: precioConIva(MAYORISTA_NETO, porcentajeIva),
    });
  };

  /** Se registró la NOTIFICACION pendiente y su correo quedó en la cola, al solicitante. */
  const esperarCorreoEncolado = async (sesion: Sesion) => {
    const [notificacion, ...otras] = await notificacionesDe(sesion.id);
    expect(otras).toHaveLength(0);
    expect(notificacion).toMatchObject({
      estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
      asunto: 'Tu cuenta profesional está activa',
    });
    const trabajos = await trabajosDe(sesion.email);
    expect(trabajos).toHaveLength(1);
    expect(trabajos[0].name).toBe(TRABAJOS_CORREO.VERIFICACION_APROBADA);
    expect(trabajos[0].data).toEqual({
      notificacionId: notificacion.id,
      destinatario: sesion.email,
      nombre: 'Andrea',
    });
  };

  const limpiarCorreos = async () => {
    const trabajos: Job<TrabajoVerificacionAprobada>[] = await correos.getJobs([
      'prioritized',
      'waiting',
      'delayed',
    ]);
    await Promise.all(
      trabajos
        .filter((t) => t.data?.destinatario?.startsWith(PREFIJO_CORREO))
        .map((t) => t.remove()),
    );
    const donde = { usuario: { email: { startsWith: PREFIJO_CORREO } } };
    await prisma.notificacion.deleteMany({ where: donde });
    await prisma.solicitudVerificacion.deleteMany({
      where: { solicitante: { email: { startsWith: PREFIJO_CORREO } } },
    });
  };

  const limpiarCatalogo = async () => {
    await prisma.articuloVenta.deleteMany({
      where: { sku: { startsWith: PREFIJO } },
    });
    await prisma.producto.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.categoria.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ProveedorSituacionTributaria)
      .useValue(new ProveedorPeluqueria())
      .compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    correos = app.get<Queue>(getQueueToken(COLAS.CORREOS));
    porcentajeIva = app.get(ConfigService).get<number>('IVA_PORCENTAJE')!;
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiarCorreos();
    await limpiarCatalogo();

    // Un producto de venta general con precio minorista y mayorista
    const categoria = await prisma.categoria.create({
      data: { nombre: `${PREFIJO} Cat` },
    });
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo`,
        descripcion: 'Repara el cabello.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta: CANALES_VENTA.GENERAL,
        categoriaId: categoria.id,
      },
    });
    const articulo = await prisma.articuloVenta.create({
      data: {
        sku: `${PREFIJO}-${randomUUID().slice(0, 8)}`,
        tipo: TIPOS_ARTICULO.FORMATO,
        precioMinoristaNeto: MINORISTA_NETO,
        precioMayoristaNeto: MAYORISTA_NETO,
      },
    });
    // La tienda solo muestra formatos con al menos una imagen
    await prisma.imagenArticulo.create({
      data: {
        articuloId: articulo.id,
        ubicacionArchivo: `articulos/${articulo.id}/principal.jpg`,
        orden: 1,
        esPrincipal: true,
      },
    });
    await prisma.formatoProducto.create({
      data: {
        id: articulo.id,
        productoId: producto.id,
        nombreFormato: '300 ml',
        pesoGramos: 320,
        altoCm: 18,
        anchoCm: 6,
        largoCm: 6,
        esPredeterminado: true,
      },
    });
    productoId = producto.id;
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiarCorreos();
  });

  afterAll(async () => {
    await limpiarCorreos();
    await limpiarCatalogo();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  it('E10-H4 · antes de aprobar, el cliente no ve el precio mayorista (RNF-04)', async () => {
    const cliente = await cuenta();

    const formato = await formatoVisto(cliente.token);

    expect(formato.precio).toBe(precioConIva(MINORISTA_NETO, porcentajeIva));
    expect(formato).not.toHaveProperty('precioMayorista');
  });

  it('E10-H4 · cambio a profesional: la aprobación automática deja la cuenta profesional y el precio mayorista visible al renovar la sesión', async () => {
    const cliente = await cuenta();

    const respuesta = await servidor()
      .post('/api/verificaciones')
      .auth(cliente.token, { type: 'bearer' })
      .expect(201);

    expect((respuesta.body as { estado: string }).estado).toBe(
      ESTADOS_SOLICITUD.APROBADA,
    );
    await esperarAccesoMayorista(cliente);
  });

  it('E10-H4 · correo de aprobación: la aprobación automática encola el correo al solicitante', async () => {
    const cliente = await cuenta();

    await servidor()
      .post('/api/verificaciones')
      .auth(cliente.token, { type: 'bearer' })
      .expect(201);

    await esperarCorreoEncolado(cliente);
  });

  it('E10-H4 · cambio a profesional: la aprobación manual deja la cuenta profesional y el precio mayorista visible al renovar la sesión', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    const cliente = await cuenta();
    await prisma.solicitudVerificacion.create({
      data: {
        solicitanteId: cliente.id,
        estado: ESTADOS_SOLICITUD.REVISION_MANUAL,
        resultadoConsultaSii: 'otro_giro',
      },
    });

    await servidor()
      .post(`/api/verificaciones/${cliente.codigoPublico}/aprobar`)
      .auth(administrador.token, { type: 'bearer' })
      .expect(200);

    await esperarAccesoMayorista(cliente);
  });

  it('E10-H4 · correo de aprobación: la aprobación manual encola el correo al solicitante, y rechazar no lo envía ni cambia el rol', async () => {
    const administrador = await cuenta(ROLES.ADMINISTRADOR);
    const aprobado = await cuenta();
    const rechazado = await cuenta();
    for (const { id } of [aprobado, rechazado]) {
      await prisma.solicitudVerificacion.create({
        data: {
          solicitanteId: id,
          estado: ESTADOS_SOLICITUD.REVISION_MANUAL,
          resultadoConsultaSii: 'otro_giro',
        },
      });
    }

    await servidor()
      .post(`/api/verificaciones/${aprobado.codigoPublico}/aprobar`)
      .auth(administrador.token, { type: 'bearer' })
      .expect(200);
    await servidor()
      .post(`/api/verificaciones/${rechazado.codigoPublico}/rechazar`)
      .auth(administrador.token, { type: 'bearer' })
      .send({ motivo: 'El certificado adjunto no es legible.' })
      .expect(200);

    await esperarCorreoEncolado(aprobado);
    expect(await notificacionesDe(rechazado.id)).toHaveLength(0);
    expect(await trabajosDe(rechazado.email)).toHaveLength(0);
    const sigueCliente = await prisma.usuario.findUniqueOrThrow({
      where: { id: rechazado.id },
    });
    expect(sigueCliente.rol).toBe(ROLES.CLIENTE);
  });
});
