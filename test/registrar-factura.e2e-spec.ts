import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AlmacenArchivos } from '../src/almacen/almacen-archivos.js';
import { AppModule } from '../src/app.module.js';
import { hoyEnLaTienda } from '../src/common/dominio/fechas.js';
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
const PREFIJO_CORREO = 'e2e-registrar-factura-';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '91';
const COMUNA = '91001';

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
}

const pdf = (relleno = 2048) =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(relleno)]);

describe('Facturación · registrar la factura emitida en el SII (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let almacen: AlmacenDePrueba;
  let hashContrasena: string;
  let compradorId: number;
  let comunaId: number;
  let datosId: number;
  let tokenPersonal: string;
  const correoComprador = `${PREFIJO_CORREO}comprador-${randomUUID()}@prueba.cl`;
  const correosCreados: string[] = [correoComprador];

  const servidor = () => request(app.getHttpServer());
  /** Un folio distinto en cada prueba, para no chocar con facturas de otras pruebas. */
  const folioNuevo = () => 900_000_000 + Math.floor(Math.random() * 99_000_000);

  const tokenDe = async (rol: Rol) => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    await prisma.usuario.create({
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
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  /** Un pedido del comprador que pidió factura con sus datos de facturación (por defecto, pagado). */
  const nuevoPedido = async (
    cambios: {
      estado?: string;
      tipoDocumento?: string;
      conDatos?: boolean;
    } = {},
  ) => {
    const {
      estado = ESTADOS_PEDIDO.PAGADO,
      tipoDocumento = TIPOS_DOCUMENTO.FACTURA,
      conDatos = true,
    } = cambios;
    const codigoPublico = randomUUID().replaceAll('-', '').slice(0, 12);
    const pedido = await prisma.pedido.create({
      data: {
        codigoPublico,
        usuarioId: compradorId,
        datosFacturacionId: conDatos ? datosId : null,
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

  const registrar = (
    codigo: string,
    folio: number | string | null = folioNuevo(),
    {
      token = tokenPersonal,
      archivo = pdf(),
      nombre = 'factura.pdf',
      campos = {},
    }: {
      token?: string;
      archivo?: Buffer | null;
      nombre?: string;
      campos?: Record<string, string>;
    } = {},
  ) => {
    let peticion = servidor()
      .post(`/api/pedidos/${codigo}/factura`)
      .auth(token, { type: 'bearer' });
    if (folio !== null) peticion = peticion.field('folio', String(folio));
    for (const [nombreCampo, valor] of Object.entries(campos)) {
      peticion = peticion.field(nombreCampo, valor);
    }
    if (archivo) peticion = peticion.attach('archivo', archivo, nombre);
    return peticion;
  };

  const documentosDe = (pedidoId: number) =>
    prisma.documentoTributario.findMany({ where: { pedidoId } });

  const limpiar = async () => {
    // Los documentos no se borran en cascada con el pedido
    await prisma.documentoTributario.deleteMany({
      where: { pedido: { usuario: { email: { startsWith: PREFIJO_CORREO } } } },
    });
    await prisma.pedido.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
    await prisma.datosFacturacion.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
  };

  beforeAll(async () => {
    almacen = new AlmacenDePrueba();
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AlmacenArchivos)
      .useValue(almacen)
      .compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiar();

    const region = await prisma.region.upsert({
      where: { codigoCut: REGION },
      update: {},
      create: { codigoCut: REGION, nombre: 'Región de prueba factura' },
    });
    comunaId = (
      await prisma.comuna.upsert({
        where: { codigoCut: COMUNA },
        update: {},
        create: {
          codigoCut: COMUNA,
          nombre: 'Comuna de prueba factura',
          regionId: region.id,
        },
      })
    ).id;
    compradorId = (
      await prisma.usuario.create({
        data: {
          codigoPublico: randomUUID(),
          nombre: 'Camila',
          apellido: 'Rojas',
          email: correoComprador,
          contrasenaHash: 'sin-uso',
          rol: ROLES.CLIENTE,
          fechaVerificacionCorreo: new Date(),
        },
      })
    ).id;
    tokenPersonal = await tokenDe(ROLES.VENDEDOR);
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiar();
    almacen.archivos.clear();
    almacen.fallarAlGuardar = false;
    datosId = (
      await prisma.datosFacturacion.create({
        data: {
          usuarioId: compradorId,
          comunaId,
          rut: '76123456-0',
          razonSocial: 'Peluquería Bella Ltda.',
          giro: 'Servicios de peluquería',
          direccion: 'Calle Falsa 123',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E9-H3 · factura registrada: guarda el documento con el folio, el receptor y los montos del pedido, y el PDF privado', async () => {
    const pedido = await nuevoPedido();
    const folio = folioNuevo();

    const respuesta = await registrar(pedido.codigo, folio, {
      campos: { fechaEmision: '2026-10-29' },
    }).expect(201);

    expect(respuesta.body).toEqual({
      codigoPedido: pedido.codigo,
      tipo: 'factura',
      folio,
      fechaEmision: '2026-10-29',
      estado: ESTADOS_DOCUMENTO.EMITIDO,
    });
    const [documento] = await documentosDe(pedido.id);
    expect(documento).toMatchObject({
      tipo: TIPOS_DOCUMENTO.FACTURA,
      folio,
      estado: ESTADOS_DOCUMENTO.EMITIDO,
      montoNeto: 10000,
      montoIva: 1900,
      montoTotal: 11900,
      rutReceptor: '76123456-0',
      razonSocialReceptor: 'Peluquería Bella Ltda.',
      giroReceptor: 'Servicios de peluquería',
      direccionReceptor: 'Calle Falsa 123',
      comunaReceptor: 'Comuna de prueba factura',
      anuladorId: null,
    });
    expect(documento.fechaEmision?.toISOString().slice(0, 10)).toBe(
      '2026-10-29',
    );
    // El PDF queda en el almacén como archivo privado y la respuesta no revela dónde
    expect(documento.ubicacionArchivo).toMatch(
      new RegExp(`^facturas/${pedido.id}/[0-9a-f-]{36}\\.pdf$`),
    );
    expect(almacen.archivos.get(documento.ubicacionArchivo as string)).toEqual({
      tipo: 'application/pdf',
      privado: true,
    });
    expect(JSON.stringify(respuesta.body)).not.toContain('facturas/');
  });

  it('E9-H3 · el documento conserva los datos del receptor aunque después se editen o se desactiven', async () => {
    const pedido = await nuevoPedido();
    await registrar(pedido.codigo).expect(201);

    await prisma.datosFacturacion.update({
      where: { id: datosId },
      data: { razonSocial: 'Otra razón social', activo: false },
    });

    const [documento] = await documentosDe(pedido.id);
    expect(documento.razonSocialReceptor).toBe('Peluquería Bella Ltda.');
  });

  it('E9-H3 · sin fecha de emisión se usa la de hoy en la tienda', async () => {
    const pedido = await nuevoPedido();

    const respuesta = await registrar(pedido.codigo).expect(201);

    expect((respuesta.body as { fechaEmision: string }).fechaEmision).toBe(
      hoyEnLaTienda(),
    );
  });

  it('E9-H3 · folio repetido: 409, no se guarda el documento y no queda el PDF en el almacén', async () => {
    const primero = await nuevoPedido();
    const segundo = await nuevoPedido();
    const folio = folioNuevo();
    await registrar(primero.codigo, folio).expect(201);
    const archivosAntes = almacen.archivos.size;

    const respuesta = await registrar(segundo.codigo, folio).expect(409);

    expect((respuesta.body as { message: string }).message).toBe(
      `Ya existe una factura con el folio ${folio}.`,
    );
    expect(await documentosDe(segundo.id)).toHaveLength(0);
    expect(almacen.archivos.size).toBe(archivosAntes);
  });

  it('RNF-12 · el mismo folio en dos pedidos a la vez: uno se registra, el otro recibe 409 y su PDF no queda en el almacén', async () => {
    const a = await nuevoPedido();
    const b = await nuevoPedido();
    const folio = folioNuevo();

    const [ra, rb] = await Promise.all([
      registrar(a.codigo, folio),
      registrar(b.codigo, folio),
    ]);

    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    const total =
      (await documentosDe(a.id)).length + (await documentosDe(b.id)).length;
    expect(total).toBe(1);
    expect(almacen.archivos.size).toBe(1);
  });

  it('RNF-12 · dos facturas distintas para el mismo pedido a la vez: una se registra y la otra recibe 409', async () => {
    const pedido = await nuevoPedido();

    const [r1, r2] = await Promise.all([
      registrar(pedido.codigo),
      registrar(pedido.codigo),
    ]);

    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await documentosDe(pedido.id)).toHaveLength(1);
    expect(almacen.archivos.size).toBe(1);
  });

  it('E9-H3 · el pedido ya tiene su factura: 409', async () => {
    const pedido = await nuevoPedido();
    await registrar(pedido.codigo).expect(201);

    const respuesta = await registrar(pedido.codigo).expect(409);

    expect((respuesta.body as { message: string }).message).toBe(
      'El pedido ya tiene una factura registrada.',
    );
    expect(await documentosDe(pedido.id)).toHaveLength(1);
  });

  it('E9-H3 · el pedido pidió boleta: 409', async () => {
    const pedido = await nuevoPedido({ tipoDocumento: TIPOS_DOCUMENTO.BOLETA });

    const respuesta = await registrar(pedido.codigo).expect(409);

    expect((respuesta.body as { message: string }).message).toBe(
      'El pedido no pidió factura.',
    );
    expect(almacen.archivos.size).toBe(0);
  });

  it('E9-H3 · el pedido no está pagado (pendiente de pago o cancelado): 409', async () => {
    for (const estado of [
      ESTADOS_PEDIDO.PENDIENTE_PAGO,
      ESTADOS_PEDIDO.CANCELADO,
    ]) {
      const pedido = await nuevoPedido({ estado });

      const respuesta = await registrar(pedido.codigo).expect(409);

      expect((respuesta.body as { message: string }).message).toBe(
        'Solo se puede registrar la factura de un pedido pagado.',
      );
      expect(await documentosDe(pedido.id)).toHaveLength(0);
    }
    expect(almacen.archivos.size).toBe(0);
  });

  it('E9-H3 · un pedido ya entregado también admite su factura', async () => {
    const pedido = await nuevoPedido({ estado: ESTADOS_PEDIDO.ENTREGADO });

    await registrar(pedido.codigo).expect(201);

    expect(await documentosDe(pedido.id)).toHaveLength(1);
  });

  it('E9-H3 · bodeguero, cliente y profesional no pueden registrar facturas (403), ni sin sesión (401)', async () => {
    const pedido = await nuevoPedido();

    for (const rol of [ROLES.BODEGUERO, ROLES.CLIENTE, ROLES.PROFESIONAL]) {
      await registrar(pedido.codigo, folioNuevo(), {
        token: await tokenDe(rol),
      }).expect(403);
    }
    await servidor()
      .post(`/api/pedidos/${pedido.codigo}/factura`)
      .field('folio', String(folioNuevo()))
      .attach('archivo', pdf(), 'factura.pdf')
      .expect(401);
    expect(await documentosDe(pedido.id)).toHaveLength(0);
  });

  it('E9-H3 · administrador y vendedor pueden registrar facturas', async () => {
    for (const rol of [ROLES.ADMINISTRADOR, ROLES.VENDEDOR]) {
      const pedido = await nuevoPedido();

      await registrar(pedido.codigo, folioNuevo(), {
        token: await tokenDe(rol),
      }).expect(201);
    }
  });

  it('E9-H3 · pedido inexistente o con un código mal formado: 404', async () => {
    await registrar('AAAAAAAAAAAA').expect(404);
    await registrar('corto').expect(404);
  });

  it('E9-H3 · sin PDF, con un archivo que no es PDF, folio o fecha inválidos, o campos de más: 400 y no cambia nada', async () => {
    const pedido = await nuevoPedido();
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(512),
    ]);

    await registrar(pedido.codigo, folioNuevo(), { archivo: null }).expect(400);
    await registrar(pedido.codigo, folioNuevo(), {
      archivo: jpeg,
      nombre: 'factura.pdf',
    }).expect(400);
    for (const folio of [null, '', 'abc', '0', '-5', '2147483648']) {
      await registrar(pedido.codigo, folio).expect(400);
    }
    await registrar(pedido.codigo, folioNuevo(), {
      campos: { fechaEmision: '2026-02-30' },
    }).expect(400);
    const futura = await registrar(pedido.codigo, folioNuevo(), {
      campos: { fechaEmision: '2999-01-01' },
    }).expect(400);
    expect((futura.body as { message: string }).message).toBe(
      'La fecha de emisión no puede ser futura.',
    );
    await registrar(pedido.codigo, folioNuevo(), {
      campos: { montoTotal: '1' },
    }).expect(400);

    expect(await documentosDe(pedido.id)).toHaveLength(0);
    expect(almacen.archivos.size).toBe(0);
  });

  it('E9-H3 · un PDF de más de 5 MB: 413', async () => {
    const pedido = await nuevoPedido();

    const respuesta = await registrar(pedido.codigo, folioNuevo(), {
      archivo: pdf(5 * 1024 * 1024),
    }).expect(413);

    expect((respuesta.body as { message: string }).message).toBe(
      'La factura no puede superar los 5 MB.',
    );
    expect(await documentosDe(pedido.id)).toHaveLength(0);
  });

  it('RNF-12 · si el almacén no responde: 503 y no se guarda el documento', async () => {
    const pedido = await nuevoPedido();
    almacen.fallarAlGuardar = true;

    await registrar(pedido.codigo).expect(503);

    expect(await documentosDe(pedido.id)).toHaveLength(0);
  });
});
