import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AlmacenArchivos } from '../src/almacen/almacen-archivos.js';
import { AppModule } from '../src/app.module.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import {
  ESTADOS_DOCUMENTO,
  ESTADOS_PEDIDO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
// R2 se reemplaza por un almacén en memoria: la prueba no depende de Cloudflare.

const CONTRASENA = 'Secreta123';
const PREFIJO_CORREO = 'e2e-descargar-documento-';

/** Almacén de prueba: guarda los archivos en memoria y puede simular que R2 falla. */
class AlmacenDePrueba extends AlmacenArchivos {
  readonly archivos = new Map<string, Buffer>();
  fallarAlLeer = false;

  guardar(clave: string, contenido: Buffer) {
    this.archivos.set(clave, contenido);
    return Promise.resolve();
  }

  eliminar(clave: string) {
    this.archivos.delete(clave);
    return Promise.resolve();
  }

  obtener(clave: string) {
    const contenido = this.archivos.get(clave);
    if (this.fallarAlLeer || !contenido) {
      return Promise.reject(new Error('R2 no responde'));
    }
    return Promise.resolve(contenido);
  }
}

interface Cuenta {
  usuarioId: number;
  token: string;
}

interface DetalleRespuesta {
  documento: {
    tipo: string;
    estado: string;
    folio: number | null;
    fechaEmision: string | null;
  } | null;
}

describe('Facturación · descargar el documento tributario (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let almacen: AlmacenDePrueba;
  let hashContrasena: string;
  let dueno: Cuenta;
  const correosCreados: string[] = [];

  const servidor = () => request(app.getHttpServer());

  const cuenta = async (rol: Rol): Promise<Cuenta> => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    const usuario = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Marcela',
        apellido: 'Soto',
        email,
        contrasenaHash: hashContrasena,
        rol,
        fechaVerificacionCorreo: new Date(),
      },
    });
    const respuesta = await servidor()
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return {
      usuarioId: usuario.id,
      token: (respuesta.body as { tokenAcceso: string }).tokenAcceso,
    };
  };

  const nuevoPedido = async (
    usuarioId: number,
    cambios: { tipoDocumento?: string; estado?: string } = {},
  ) => {
    const {
      tipoDocumento = TIPOS_DOCUMENTO.FACTURA,
      estado = ESTADOS_PEDIDO.PAGADO,
    } = cambios;
    const codigoPublico = randomUUID().replaceAll('-', '').slice(0, 12);
    const pedido = await prisma.pedido.create({
      data: {
        codigoPublico,
        usuarioId,
        fechaExpiracionPago: new Date(Date.now() + 15 * 60_000),
        estadoActual: estado,
        tipoEntrega: TIPOS_ENTREGA.RETIRO,
        tipoDocumentoSolicitado: tipoDocumento,
        porcentajeIva: 19,
        montoNeto: 10000,
        montoIva: 1900,
        montoTotal: 11900,
        historial: { create: [{ correlativo: 1, estado }] },
      },
    });
    return { id: pedido.id, codigo: codigoPublico };
  };

  /** Registra la factura como lo deja E9-H3: el documento en la base y su PDF en el almacén. */
  const registrarFactura = async (
    pedidoId: number,
    folio: number,
    contenido = Buffer.from('%PDF-1.7\nfactura de prueba'),
  ) => {
    const clave = `facturas/${pedidoId}/${randomUUID()}.pdf`;
    almacen.archivos.set(clave, contenido);
    const documento = await prisma.documentoTributario.create({
      data: {
        pedidoId,
        tipo: TIPOS_DOCUMENTO.FACTURA,
        folio,
        fechaEmision: new Date('2026-10-29T00:00:00Z'),
        estado: ESTADOS_DOCUMENTO.EMITIDO,
        montoNeto: 10000,
        montoIva: 1900,
        montoTotal: 11900,
        ubicacionArchivo: clave,
      },
    });
    return { id: documento.id, clave, contenido };
  };

  const descargar = (codigo: string, token = dueno.token) =>
    servidor()
      .get(`/api/pedidos/${codigo}/documento`)
      .auth(token, { type: 'bearer' })
      .buffer(true)
      .parse((respuesta, devolver) => {
        const partes: Buffer[] = [];
        respuesta.on('data', (parte: Buffer) => partes.push(parte));
        respuesta.on('end', () => devolver(null, Buffer.concat(partes)));
      });

  const detalle = (codigo: string, token = dueno.token) =>
    servidor().get(`/api/pedidos/${codigo}`).auth(token, { type: 'bearer' });

  const folioNuevo = () => 800_000_000 + Math.floor(Math.random() * 99_000_000);

  const limpiar = async () => {
    // Los documentos no se borran en cascada con el pedido; el anulado apunta al anulador
    await prisma.documentoTributario.updateMany({
      where: { pedido: { usuario: { email: { startsWith: PREFIJO_CORREO } } } },
      data: { anuladorId: null },
    });
    await prisma.documentoTributario.deleteMany({
      where: { pedido: { usuario: { email: { startsWith: PREFIJO_CORREO } } } },
    });
    await prisma.pedido.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
  };

  beforeAll(async () => {
    almacen = new AlmacenDePrueba();
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AlmacenArchivos)
      .useValue(almacen)
      .compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiar();
    dueno = await cuenta(ROLES.CLIENTE);
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiar();
    almacen.archivos.clear();
    almacen.fallarAlLeer = false;
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  it('E9-H4 · documento disponible: el dueño descarga el PDF registrado, como archivo y sin caché compartida', async () => {
    const pedido = await nuevoPedido(dueno.usuarioId);
    const folio = folioNuevo();
    const factura = await registrarFactura(pedido.id, folio);

    const respuesta = await descargar(pedido.codigo).expect(200);

    expect(respuesta.headers['content-type']).toMatch(/^application\/pdf/);
    expect(respuesta.headers['content-disposition']).toBe(
      `attachment; filename="factura-${folio}.pdf"`,
    );
    expect(respuesta.headers['cache-control']).toBe('private, no-store');
    expect(respuesta.headers['x-content-type-options']).toBe('nosniff');
    expect(respuesta.headers['content-length']).toBe(
      String(factura.contenido.length),
    );
    expect(Buffer.isBuffer(respuesta.body)).toBe(true);
    expect((respuesta.body as Buffer).equals(factura.contenido)).toBe(true);
  });

  it('E9-H4 · el profesional también descarga la factura de su pedido', async () => {
    const profesional = await cuenta(ROLES.PROFESIONAL);
    const pedido = await nuevoPedido(profesional.usuarioId);
    await registrarFactura(pedido.id, folioNuevo());

    await descargar(pedido.codigo, profesional.token).expect(200);
  });

  it('E9-H4 · documento pendiente: el detalle del pedido lo indica y la descarga responde 404 sin archivo', async () => {
    const pedido = await nuevoPedido(dueno.usuarioId);

    const consulta = await detalle(pedido.codigo).expect(200);
    expect((consulta.body as DetalleRespuesta).documento).toEqual({
      tipo: 'factura',
      estado: 'pendiente',
      folio: null,
      fechaEmision: null,
    });

    const respuesta = await servidor()
      .get(`/api/pedidos/${pedido.codigo}/documento`)
      .auth(dueno.token, { type: 'bearer' })
      .expect(404);
    expect((respuesta.body as { message: string }).message).toBe(
      'El documento del pedido aún no está disponible.',
    );
    expect(respuesta.headers['content-type']).not.toMatch(/pdf/);
  });

  it('E9-H4 · documento disponible: el detalle del pedido muestra el folio y la fecha, sin revelar dónde está el archivo', async () => {
    const pedido = await nuevoPedido(dueno.usuarioId);
    const folio = folioNuevo();
    const factura = await registrarFactura(pedido.id, folio);

    const consulta = await detalle(pedido.codigo).expect(200);

    expect((consulta.body as DetalleRespuesta).documento).toEqual({
      tipo: 'factura',
      estado: 'disponible',
      folio,
      fechaEmision: '2026-10-29',
    });
    expect(JSON.stringify(consulta.body)).not.toContain(factura.clave);
    expect(JSON.stringify(consulta.body)).not.toContain('facturas/');
  });

  it('E9-H4 · un pedido con boleta no tiene documento que descargar: el detalle lo deja en null y la descarga es 404', async () => {
    const pedido = await nuevoPedido(dueno.usuarioId, {
      tipoDocumento: TIPOS_DOCUMENTO.BOLETA,
    });

    const consulta = await detalle(pedido.codigo).expect(200);
    expect((consulta.body as DetalleRespuesta).documento).toBeNull();
    await descargar(pedido.codigo).expect(404);
  });

  it('E9-H4 · una factura anulada por otro documento deja de estar disponible', async () => {
    const pedido = await nuevoPedido(dueno.usuarioId);
    const factura = await registrarFactura(pedido.id, folioNuevo());
    const anulador = await prisma.documentoTributario.create({
      data: {
        pedidoId: pedido.id,
        tipo: 'nota_credito',
        folio: folioNuevo(),
        estado: ESTADOS_DOCUMENTO.EMITIDO,
        montoNeto: 10000,
        montoIva: 1900,
        montoTotal: 11900,
      },
    });
    await prisma.documentoTributario.update({
      where: { id: factura.id },
      data: { anuladorId: anulador.id },
    });

    const consulta = await detalle(pedido.codigo).expect(200);
    expect((consulta.body as DetalleRespuesta).documento?.estado).toBe(
      'pendiente',
    );
    await descargar(pedido.codigo).expect(404);
  });

  it('E9-H4 · el pedido de otra cuenta o inexistente responde 404 y nunca entrega el archivo', async () => {
    const otra = await cuenta(ROLES.CLIENTE);
    const pedido = await nuevoPedido(otra.usuarioId);
    await registrarFactura(pedido.id, folioNuevo());

    await descargar(pedido.codigo).expect(404);
    await detalle(pedido.codigo).expect(404);
    await descargar('AAAAAAAAAAAA').expect(404);
    await descargar('corto').expect(404);
    // La dueña sí lo descarga
    await descargar(pedido.codigo, otra.token).expect(200);
  });

  it('E9-H4 · la ruta del cliente no la usa el personal (403) y sin sesión responde 401', async () => {
    const pedido = await nuevoPedido(dueno.usuarioId);
    await registrarFactura(pedido.id, folioNuevo());

    for (const rol of [ROLES.ADMINISTRADOR, ROLES.VENDEDOR, ROLES.BODEGUERO]) {
      const personal = await cuenta(rol);
      await descargar(pedido.codigo, personal.token).expect(403);
    }
    await servidor().get(`/api/pedidos/${pedido.codigo}/documento`).expect(401);
  });

  it('E9-H4 · si el almacén no responde: 503 sin detalles y el pedido sigue consultable', async () => {
    const pedido = await nuevoPedido(dueno.usuarioId);
    await registrarFactura(pedido.id, folioNuevo());
    almacen.fallarAlLeer = true;

    const respuesta = await servidor()
      .get(`/api/pedidos/${pedido.codigo}/documento`)
      .auth(dueno.token, { type: 'bearer' })
      .expect(503);

    expect((respuesta.body as { message: string }).message).toBe(
      'No se pudo obtener el documento. Intenta de nuevo en unos minutos.',
    );
    expect(JSON.stringify(respuesta.body)).not.toContain('R2');
    await detalle(pedido.codigo).expect(200);
  });
  describe('descarga del personal (vendedor y administrador)', () => {
    const descargarFactura = (codigo: string, token: string) =>
      servidor()
        .get(`/api/pedidos/${codigo}/factura`)
        .auth(token, { type: 'bearer' })
        .buffer(true)
        .parse((respuesta, devolver) => {
          const partes: Buffer[] = [];
          respuesta.on('data', (parte: Buffer) => partes.push(parte));
          respuesta.on('end', () => devolver(null, Buffer.concat(partes)));
        });

    it('E9-H4 · el vendedor y el administrador descargan la factura de cualquier pedido, con el mismo archivo y sin caché compartida', async () => {
      const pedido = await nuevoPedido(dueno.usuarioId);
      const folio = folioNuevo();
      const factura = await registrarFactura(pedido.id, folio);

      for (const rol of [ROLES.VENDEDOR, ROLES.ADMINISTRADOR]) {
        const personal = await cuenta(rol);

        const respuesta = await descargarFactura(
          pedido.codigo,
          personal.token,
        ).expect(200);

        expect(respuesta.headers['content-type']).toMatch(/^application\/pdf/);
        expect(respuesta.headers['content-disposition']).toBe(
          `attachment; filename="factura-${folio}.pdf"`,
        );
        expect(respuesta.headers['cache-control']).toBe('private, no-store');
        expect((respuesta.body as Buffer).equals(factura.contenido)).toBe(true);
      }
    });

    it('E9-H4 · bodeguero, cliente y profesional no descargan por la ruta del personal (403), ni sin sesión (401)', async () => {
      const pedido = await nuevoPedido(dueno.usuarioId);
      await registrarFactura(pedido.id, folioNuevo());

      for (const rol of [ROLES.BODEGUERO, ROLES.CLIENTE, ROLES.PROFESIONAL]) {
        const otra = await cuenta(rol);
        await descargarFactura(pedido.codigo, otra.token).expect(403);
      }
      await servidor().get(`/api/pedidos/${pedido.codigo}/factura`).expect(401);
    });

    it('E9-H4 · factura pendiente o anulada, pedido inexistente o con un código mal formado: 404 sin archivo', async () => {
      const personal = await cuenta(ROLES.VENDEDOR);
      const pendiente = await nuevoPedido(dueno.usuarioId);
      const respuesta = await servidor()
        .get(`/api/pedidos/${pendiente.codigo}/factura`)
        .auth(personal.token, { type: 'bearer' })
        .expect(404);
      expect((respuesta.body as { message: string }).message).toBe(
        'El documento del pedido aún no está disponible.',
      );

      const anulado = await nuevoPedido(dueno.usuarioId);
      const factura = await registrarFactura(anulado.id, folioNuevo());
      const anulador = await prisma.documentoTributario.create({
        data: {
          pedidoId: anulado.id,
          tipo: 'nota_credito',
          folio: folioNuevo(),
          estado: ESTADOS_DOCUMENTO.EMITIDO,
          montoNeto: 10000,
          montoIva: 1900,
          montoTotal: 11900,
        },
      });
      await prisma.documentoTributario.update({
        where: { id: factura.id },
        data: { anuladorId: anulador.id },
      });
      await descargarFactura(anulado.codigo, personal.token).expect(404);
      await descargarFactura('AAAAAAAAAAAA', personal.token).expect(404);
      await descargarFactura('corto', personal.token).expect(404);
    });

    it('E9-H4 · si el almacén no responde: 503 sin detalles', async () => {
      const personal = await cuenta(ROLES.ADMINISTRADOR);
      const pedido = await nuevoPedido(dueno.usuarioId);
      await registrarFactura(pedido.id, folioNuevo());
      almacen.fallarAlLeer = true;

      const respuesta = await servidor()
        .get(`/api/pedidos/${pedido.codigo}/factura`)
        .auth(personal.token, { type: 'bearer' })
        .expect(503);

      expect(JSON.stringify(respuesta.body)).not.toContain('R2');
    });
  });
});
