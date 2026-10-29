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
  CANALES_VENTA,
  ESTADOS_PEDIDO,
  ORIGENES_DESCRIPCION,
  TIPOS_ARTICULO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
  TIPOS_MOVIMIENTO,
} from '../src/common/dominio/valores.js';
import { MAXIMO_INT4 } from '../src/common/validacion/enteros.js';
import { configurarApp } from '../src/configurar-app.js';
import {
  type LineaVenta,
  VentaStockService,
} from '../src/modulos/inventario/venta-stock.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-cancelar-pedido';
const PREFIJO_CORREO = 'e2e-cancelar-pedido-';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '90';
const COMUNA = '90001';
const SOLO_PENDIENTE = 'Solo se puede cancelar un pedido pendiente de pago.';

describe('Pedidos · cancelar un pedido pendiente de pago (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let ventaStock: VentaStockService;
  let hashContrasena: string;
  let compradorId: number;
  let categoriaId: number;
  let comunaId: number;
  let ubicacionId: number;
  const correoComprador = `${PREFIJO_CORREO}comprador-${randomUUID()}@prueba.cl`;
  const correosCreados: string[] = [correoComprador];

  const unico = () => randomUUID().slice(0, 8);
  const servidor = () => request(app.getHttpServer());

  const cuenta = async (rol: Rol) => {
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

  const nuevoFormato = async (stock: number) => {
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo ${unico()}`,
        descripcion: 'Repara el cabello.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta: CANALES_VENTA.GENERAL,
        categoriaId,
      },
    });
    const articulo = await prisma.articuloVenta.create({
      data: { sku: `${PREFIJO}-${unico()}`, tipo: TIPOS_ARTICULO.FORMATO },
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
    await prisma.existencia.create({
      data: { formatoId: articulo.id, ubicacionId, cantidad: stock },
    });
    return articulo.id;
  };

  const stockDe = async (formatoId: number) =>
    (
      await prisma.existencia.findUnique({
        where: { formatoId_ubicacionId: { formatoId, ubicacionId } },
      })
    )?.cantidad ?? 0;

  /**
   * Un pedido del comprador con su primer cambio de estado. Si lleva líneas, descuenta su stock
   * en la misma transacción, como lo hará la creación del pedido (E5).
   */
  const nuevoPedido = async (
    estado: string = ESTADOS_PEDIDO.PENDIENTE_PAGO,
    lineas: LineaVenta[] = [],
  ) => {
    const codigoPublico = randomUUID().replaceAll('-', '').slice(0, 12);
    const pedido = await prisma.$transaction(async (tx) => {
      const creado = await tx.pedido.create({
        data: {
          codigoPublico,
          usuarioId: compradorId,
          fechaExpiracionPago: new Date(Date.now() + 15 * 60_000),
          estadoActual: estado,
          tipoEntrega: TIPOS_ENTREGA.RETIRO,
          tipoDocumentoSolicitado: TIPOS_DOCUMENTO.BOLETA,
          porcentajeIva: 19,
          montoNeto: 0,
          montoIva: 0,
          montoTotal: 0,
          historial: { create: [{ correlativo: 1, estado }] },
        },
      });
      if (lineas.length > 0) {
        await ventaStock.descontarPorPedido(tx, creado.id, lineas);
      }
      return creado;
    });
    return { id: pedido.id, codigo: codigoPublico };
  };

  const cancelar = (token: string, codigo: string, cuerpo?: object) =>
    servidor()
      .post(`/api/pedidos/${codigo}/cancelar`)
      .auth(token, { type: 'bearer' })
      .send(cuerpo);

  const estadoDe = async (id: number) =>
    (await prisma.pedido.findUniqueOrThrow({ where: { id } })).estadoActual;

  const historialDe = (id: number) =>
    prisma.historialEstadoPedido.findMany({
      where: { pedidoId: id },
      orderBy: { correlativo: 'asc' },
    });

  const reingresosDe = (id: number) =>
    prisma.movimientoInventario.findMany({
      where: { pedidoId: id, tipo: TIPOS_MOVIMIENTO.REINGRESO },
    });

  const limpiar = async () => {
    const formatosPrueba = {
      formato: { articulo: { sku: { startsWith: PREFIJO } } },
    };
    await prisma.movimientoInventario.deleteMany({ where: formatosPrueba });
    await prisma.existencia.deleteMany({ where: formatosPrueba });
    // El historial y las líneas se borran en cascada con el pedido
    await prisma.pedido.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
    await prisma.articuloVenta.deleteMany({
      where: { sku: { startsWith: PREFIJO } },
    });
    await prisma.producto.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.categoria.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.ubicacion.deleteMany({
      where: { bodega: { nombre: { startsWith: PREFIJO } } },
    });
    await prisma.bodega.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    ventaStock = app.get(VentaStockService);
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiar();

    const region = await prisma.region.upsert({
      where: { codigoCut: REGION },
      update: {},
      create: { codigoCut: REGION, nombre: 'Región de prueba cancelar' },
    });
    comunaId = (
      await prisma.comuna.upsert({
        where: { codigoCut: COMUNA },
        update: {},
        create: {
          codigoCut: COMUNA,
          nombre: 'Comuna de prueba cancelar',
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
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiar();
    const bodega = await prisma.bodega.create({
      data: {
        nombre: `${PREFIJO} Tienda`,
        direccion: 'Calle de prueba 400',
        tipo: 'tienda',
        comunaId,
      },
    });
    ubicacionId = (
      await prisma.ubicacion.create({
        data: { bodegaId: bodega.id, codigo: 'A-01' },
      })
    ).id;
    categoriaId = (
      await prisma.categoria.create({
        data: { nombre: `${PREFIJO} Cat ${unico()}` },
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

  it('E8-H3 · pedido pendiente de pago: queda cancelado, devuelve su stock y registra el cambio en el historial', async () => {
    const formatoId = await nuevoFormato(8);
    const personal = await cuenta(ROLES.VENDEDOR);
    const pedido = await nuevoPedido(ESTADOS_PEDIDO.PENDIENTE_PAGO, [
      { articuloId: formatoId, cantidad: 5 },
    ]);
    expect(await stockDe(formatoId)).toBe(3);

    const respuesta = await cancelar(personal.token, pedido.codigo, {
      comentario: '  El cliente pidió anular la compra.  ',
    }).expect(200);

    expect(respuesta.body).toEqual({
      codigoPublico: pedido.codigo,
      estado: ESTADOS_PEDIDO.CANCELADO,
    });
    expect(await estadoDe(pedido.id)).toBe(ESTADOS_PEDIDO.CANCELADO);
    // El stock vuelve a la misma ubicación de donde salió
    expect(await stockDe(formatoId)).toBe(8);
    expect(
      (await reingresosDe(pedido.id)).map((movimiento) => ({
        formatoId: movimiento.formatoId,
        destino: movimiento.ubicacionDestinoId,
        cantidad: movimiento.cantidad,
        usuarioId: movimiento.usuarioId,
      })),
    ).toEqual([
      {
        formatoId,
        destino: ubicacionId,
        cantidad: 5,
        usuarioId: personal.usuarioId,
      },
    ]);
    // El cambio queda en el historial, con quién lo hizo y el comentario recortado
    expect(
      (await historialDe(pedido.id)).map((cambio) => ({
        correlativo: cambio.correlativo,
        estado: cambio.estado,
        usuarioId: cambio.usuarioId,
        comentario: cambio.comentario,
      })),
    ).toEqual([
      {
        correlativo: 1,
        estado: ESTADOS_PEDIDO.PENDIENTE_PAGO,
        usuarioId: null,
        comentario: null,
      },
      {
        correlativo: 2,
        estado: ESTADOS_PEDIDO.CANCELADO,
        usuarioId: personal.usuarioId,
        comentario: 'El cliente pidió anular la compra.',
      },
    ]);
  });

  it('E8-H3 · el comentario es opcional y cancelan los roles con permiso de gestionar pedidos', async () => {
    for (const rol of [ROLES.ADMINISTRADOR, ROLES.BODEGUERO, ROLES.VENDEDOR]) {
      const personal = await cuenta(rol);
      const pedido = await nuevoPedido();

      await cancelar(personal.token, pedido.codigo).expect(200);

      expect(await estadoDe(pedido.id)).toBe(ESTADOS_PEDIDO.CANCELADO);
      expect((await historialDe(pedido.id)).at(-1)).toMatchObject({
        estado: ESTADOS_PEDIDO.CANCELADO,
        usuarioId: personal.usuarioId,
        comentario: null,
      });
    }
  });

  it('E8-H3 · pedido ya pagado: no permite la cancelación (409) y no cambia el estado, el stock ni el historial', async () => {
    const formatoId = await nuevoFormato(8);
    const personal = await cuenta(ROLES.ADMINISTRADOR);

    for (const estado of [
      ESTADOS_PEDIDO.PAGADO,
      ESTADOS_PEDIDO.EN_PREPARACION,
      ESTADOS_PEDIDO.DESPACHADO,
      ESTADOS_PEDIDO.CANCELADO,
    ]) {
      const pedido = await nuevoPedido(estado, [
        { articuloId: formatoId, cantidad: 1 },
      ]);
      const stockAntes = await stockDe(formatoId);

      const respuesta = await cancelar(personal.token, pedido.codigo).expect(
        409,
      );

      expect(respuesta.body).toMatchObject({ message: SOLO_PENDIENTE });
      expect(await estadoDe(pedido.id)).toBe(estado);
      expect(await stockDe(formatoId)).toBe(stockAntes);
      expect(await reingresosDe(pedido.id)).toHaveLength(0);
      expect(await historialDe(pedido.id)).toHaveLength(1);
    }
  });

  it('E8-H3 · cliente sin permiso de cancelar: 403 y el pedido sigue pendiente de pago, con su stock', async () => {
    const formatoId = await nuevoFormato(8);
    const pedido = await nuevoPedido(ESTADOS_PEDIDO.PENDIENTE_PAGO, [
      { articuloId: formatoId, cantidad: 2 },
    ]);

    for (const rol of [ROLES.CLIENTE, ROLES.PROFESIONAL]) {
      const comprador = await cuenta(rol);
      await cancelar(comprador.token, pedido.codigo).expect(403);
    }
    await servidor().post(`/api/pedidos/${pedido.codigo}/cancelar`).expect(401);

    expect(await estadoDe(pedido.id)).toBe(ESTADOS_PEDIDO.PENDIENTE_PAGO);
    expect(await stockDe(formatoId)).toBe(6);
    expect(await historialDe(pedido.id)).toHaveLength(1);
  });

  it('E8-H3 · pedido inexistente o con un código mal formado: 404', async () => {
    const personal = await cuenta(ROLES.VENDEDOR);

    for (const codigo of ['ZZZZZZZZZZZZ', 'corto', '12345678901234567890']) {
      const respuesta = await cancelar(personal.token, codigo).expect(404);
      expect(respuesta.body).toMatchObject({
        message: 'El pedido no existe.',
      });
    }
  });

  it('E8-H3 · comentario demasiado largo o que no es texto: 400 y el pedido no cambia', async () => {
    const personal = await cuenta(ROLES.VENDEDOR);
    const pedido = await nuevoPedido();

    await cancelar(personal.token, pedido.codigo, {
      comentario: 'x'.repeat(501),
    }).expect(400);
    await cancelar(personal.token, pedido.codigo, { comentario: 123 }).expect(
      400,
    );
    await cancelar(personal.token, pedido.codigo, { otro: 'dato' }).expect(400);

    expect(await estadoDe(pedido.id)).toBe(ESTADOS_PEDIDO.PENDIENTE_PAGO);
  });

  it('RNF-13 · dos cancelaciones simultáneas del mismo pedido: una lo cancela, la otra recibe 409 y el stock vuelve una sola vez', async () => {
    const formatoId = await nuevoFormato(8);
    const personal = await cuenta(ROLES.ADMINISTRADOR);
    const pedido = await nuevoPedido(ESTADOS_PEDIDO.PENDIENTE_PAGO, [
      { articuloId: formatoId, cantidad: 5 },
    ]);

    const respuestas = await Promise.all([
      cancelar(personal.token, pedido.codigo),
      cancelar(personal.token, pedido.codigo),
    ]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await stockDe(formatoId)).toBe(8);
    expect(await reingresosDe(pedido.id)).toHaveLength(1);
    expect(await historialDe(pedido.id)).toHaveLength(2);
  });

  it('RNF-12 · si no se puede devolver el stock, la cancelación se revierte completa', async () => {
    const formatoId = await nuevoFormato(8);
    const personal = await cuenta(ROLES.ADMINISTRADOR);
    const pedido = await nuevoPedido(ESTADOS_PEDIDO.PENDIENTE_PAGO, [
      { articuloId: formatoId, cantidad: 5 },
    ]);
    // La ubicación quedó al tope: devolver las 5 unidades superaría el máximo permitido
    await prisma.existencia.update({
      where: { formatoId_ubicacionId: { formatoId, ubicacionId } },
      data: { cantidad: MAXIMO_INT4 },
    });

    await cancelar(personal.token, pedido.codigo).expect(409);

    expect(await estadoDe(pedido.id)).toBe(ESTADOS_PEDIDO.PENDIENTE_PAGO);
    expect(await historialDe(pedido.id)).toHaveLength(1);
    expect(await reingresosDe(pedido.id)).toHaveLength(0);
    expect(await stockDe(formatoId)).toBe(MAXIMO_INT4);
  });
});
