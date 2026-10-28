import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { ROLES } from '../src/common/dominio/roles.js';
import {
  CANALES_VENTA,
  ESTADOS_PEDIDO,
  ORIGENES_DESCRIPCION,
  TIPOS_ARTICULO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
  TIPOS_MOVIMIENTO,
  TIPOS_NOTIFICACION,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { stockVendible } from '../src/modulos/catalogo/disponibilidad.js';
import {
  type LineaVenta,
  VentaStockService,
} from '../src/modulos/inventario/venta-stock.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
// Sin rutas propias: el servicio se llama como lo hará el pedido (E5), en su transacción.

// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-venta-stock';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '92';
const COMUNA = '92001';

describe('Inventario · stock de la venta (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let servicio: VentaStockService;
  let compradorId: number;
  let categoriaId: number;
  let comunaId: number;
  /** Ubicaciones de la tienda: A-02 se crea antes (id menor) que A-01. */
  let a02: number;
  let a01: number;
  /** Ubicación de una bodega que no abastece la venta online, con el código menor. */
  let fueraDeLinea: number;
  const correoComprador = `e2e-venta-stock-${randomUUID()}@prueba.cl`;

  const unico = () => randomUUID().slice(0, 8);

  const nuevoFormato = async (stockMinimo = 0) => {
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
        stockMinimo,
        pesoGramos: 320,
        altoCm: 18,
        anchoCm: 6,
        largoCm: 6,
        esPredeterminado: true,
      },
    });
    return articulo.id;
  };

  const nuevoPack = async (componentes: LineaVenta[]) => {
    const articulo = await prisma.articuloVenta.create({
      data: { sku: `${PREFIJO}-${unico()}`, tipo: TIPOS_ARTICULO.PACK },
    });
    await prisma.pack.create({
      data: {
        id: articulo.id,
        nombre: `${PREFIJO} Pack ${unico()}`,
        descripcion: 'Rutina completa.',
        canalVenta: CANALES_VENTA.GENERAL,
        componentes: {
          create: componentes.map(({ articuloId, cantidad }) => ({
            formatoId: articuloId,
            cantidad,
          })),
        },
      },
    });
    return articulo.id;
  };

  const nuevoPedido = async () =>
    (
      await prisma.pedido.create({
        data: {
          codigoPublico: randomUUID().replaceAll('-', '').slice(0, 12),
          usuarioId: compradorId,
          fechaExpiracionPago: new Date(Date.now() + 15 * 60_000),
          estadoActual: ESTADOS_PEDIDO.PENDIENTE_PAGO,
          tipoEntrega: TIPOS_ENTREGA.RETIRO,
          tipoDocumentoSolicitado: TIPOS_DOCUMENTO.BOLETA,
          porcentajeIva: 19,
          montoNeto: 0,
          montoIva: 0,
          montoTotal: 0,
        },
      })
    ).id;

  const conStock = (formatoId: number, ubicacionId: number, cantidad: number) =>
    prisma.existencia.create({ data: { formatoId, ubicacionId, cantidad } });

  const stock = async (formatoId: number, ubicacionId: number) =>
    (
      await prisma.existencia.findUnique({
        where: { formatoId_ubicacionId: { formatoId, ubicacionId } },
      })
    )?.cantidad ?? 0;

  /** Crea el pedido y descuenta su stock en una transacción, como lo hará E5. */
  const vender = async (lineas: LineaVenta[]) => {
    const pedidoId = await nuevoPedido();
    const { avisos } = await prisma.$transaction((tx) =>
      servicio.descontarPorPedido(tx, pedidoId, lineas),
    );
    await servicio.encolarAvisos(avisos);
    return pedidoId;
  };

  const cancelar = (pedidoId: number) =>
    prisma.$transaction((tx) =>
      servicio.reingresarPorPedido(tx, pedidoId, null),
    );

  const movimientos = (pedidoId: number) =>
    prisma.movimientoInventario.findMany({
      where: { pedidoId },
      orderBy: { id: 'asc' },
    });

  const limpiar = async () => {
    const formatosPrueba = {
      formato: { articulo: { sku: { startsWith: PREFIJO } } },
    };
    await prisma.notificacion.deleteMany({
      where: {
        tipo: TIPOS_NOTIFICACION.STOCK_BAJO,
        asunto: { contains: PREFIJO },
      },
    });
    await prisma.movimientoInventario.deleteMany({ where: formatosPrueba });
    await prisma.existencia.deleteMany({ where: formatosPrueba });
    await prisma.pedido.deleteMany({
      where: { usuario: { email: correoComprador } },
    });
    // Los packs antes que los formatos que llevan como componentes
    await prisma.articuloVenta.deleteMany({
      where: { sku: { startsWith: PREFIJO }, tipo: TIPOS_ARTICULO.PACK },
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
    servicio = app.get(VentaStockService);
    await limpiar();

    const region = await prisma.region.upsert({
      where: { codigoCut: REGION },
      update: {},
      create: { codigoCut: REGION, nombre: 'Región de prueba venta' },
    });
    comunaId = (
      await prisma.comuna.upsert({
        where: { codigoCut: COMUNA },
        update: {},
        create: {
          codigoCut: COMUNA,
          nombre: 'Comuna de prueba venta',
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
    await limpiar();
    const tienda = await prisma.bodega.create({
      data: {
        nombre: `${PREFIJO} Tienda`,
        direccion: 'Calle de prueba 200',
        tipo: 'tienda',
        comunaId,
      },
    });
    a02 = (
      await prisma.ubicacion.create({
        data: { bodegaId: tienda.id, codigo: 'A-02' },
      })
    ).id;
    a01 = (
      await prisma.ubicacion.create({
        data: { bodegaId: tienda.id, codigo: 'A-01' },
      })
    ).id;
    const bodegaInterna = await prisma.bodega.create({
      data: {
        nombre: `${PREFIJO} Interna`,
        direccion: 'Calle de prueba 201',
        tipo: 'bodega',
        comunaId,
        abasteceVentaOnline: false,
      },
    });
    fueraDeLinea = (
      await prisma.ubicacion.create({
        data: { bodegaId: bodegaInterna.id, codigo: 'A-00' },
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
    await prisma.usuario.deleteMany({ where: { email: correoComprador } });
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E11-H7 · descuento por venta: en varias ubicaciones descuenta siguiendo el orden del código y deja movimientos ligados al pedido', async () => {
    const formatoId = await nuevoFormato();
    await conStock(formatoId, a02, 10);
    await conStock(formatoId, a01, 2);

    const pedidoId = await vender([{ articuloId: formatoId, cantidad: 5 }]);

    // A-01 va antes que A-02 aunque se creó después
    expect(await stock(formatoId, a01)).toBe(0);
    expect(await stock(formatoId, a02)).toBe(7);
    expect(
      (await movimientos(pedidoId)).map((m) => ({
        tipo: m.tipo,
        origen: m.ubicacionOrigenId,
        cantidad: m.cantidad,
        usuario: m.usuarioId,
      })),
    ).toEqual([
      { tipo: TIPOS_MOVIMIENTO.VENTA, origen: a01, cantidad: 2, usuario: null },
      { tipo: TIPOS_MOVIMIENTO.VENTA, origen: a02, cantidad: 3, usuario: null },
    ]);
  });

  it('E11-H7 · descuento por venta: sin stock suficiente responde 409 y no cambia nada', async () => {
    const formatoId = await nuevoFormato();
    await conStock(formatoId, a01, 1);
    await conStock(formatoId, a02, 1);

    await expect(
      vender([{ articuloId: formatoId, cantidad: 3 }]),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await stock(formatoId, a01)).toBe(1);
    expect(await stock(formatoId, a02)).toBe(1);
    expect(
      await prisma.movimientoInventario.count({ where: { formatoId } }),
    ).toBe(0);
  });

  it('E11-H7 · pack vendido: descuenta el stock de cada formato componente', async () => {
    const acondicionador = await nuevoFormato();
    const mascarilla = await nuevoFormato();
    await conStock(acondicionador, a01, 10);
    await conStock(mascarilla, a01, 10);
    const packId = await nuevoPack([
      { articuloId: acondicionador, cantidad: 1 },
      { articuloId: mascarilla, cantidad: 2 },
    ]);

    const pedidoId = await vender([{ articuloId: packId, cantidad: 2 }]);

    expect(await stock(acondicionador, a01)).toBe(8);
    expect(await stock(mascarilla, a01)).toBe(6);
    const ventas = await movimientos(pedidoId);
    expect(ventas.every((m) => m.tipo === TIPOS_MOVIMIENTO.VENTA)).toBe(true);
    expect(ventas.map((m) => [m.formatoId, m.cantidad])).toEqual(
      expect.arrayContaining([
        [acondicionador, 2],
        [mascarilla, 4],
      ]),
    );
  });

  it('E11-H7 · pack vendido: si un componente no alcanza, no descuenta ninguno', async () => {
    const acondicionador = await nuevoFormato();
    const mascarilla = await nuevoFormato();
    await conStock(acondicionador, a01, 10);
    await conStock(mascarilla, a01, 3);
    const packId = await nuevoPack([
      { articuloId: acondicionador, cantidad: 1 },
      { articuloId: mascarilla, cantidad: 2 },
    ]);

    await expect(
      vender([{ articuloId: packId, cantidad: 2 }]),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await stock(acondicionador, a01)).toBe(10);
    expect(await stock(mascarilla, a01)).toBe(3);
  });

  it('E11-H7 · reingreso por cancelación: devuelve las unidades a sus ubicaciones con un movimiento de reingreso, una sola vez', async () => {
    const formatoId = await nuevoFormato();
    await conStock(formatoId, a01, 2);
    await conStock(formatoId, a02, 10);
    const pedidoId = await vender([{ articuloId: formatoId, cantidad: 5 }]);

    await cancelar(pedidoId);

    expect(await stock(formatoId, a01)).toBe(2);
    expect(await stock(formatoId, a02)).toBe(10);
    const reingresos = (await movimientos(pedidoId)).filter(
      (m) => m.tipo === TIPOS_MOVIMIENTO.REINGRESO,
    );
    expect(reingresos.map((m) => [m.ubicacionDestinoId, m.cantidad])).toEqual(
      expect.arrayContaining([
        [a01, 2],
        [a02, 3],
      ]),
    );

    // Una segunda cancelación (o dos simultáneas) no devuelve dos veces
    await Promise.all([cancelar(pedidoId), cancelar(pedidoId)]);
    expect(await stock(formatoId, a01)).toBe(2);
    expect(await stock(formatoId, a02)).toBe(10);
  });

  it('E11-H7 · reingreso por cancelación: un pack devuelve cada formato componente', async () => {
    const acondicionador = await nuevoFormato();
    const mascarilla = await nuevoFormato();
    await conStock(acondicionador, a01, 5);
    await conStock(mascarilla, a01, 5);
    const packId = await nuevoPack([
      { articuloId: acondicionador, cantidad: 1 },
      { articuloId: mascarilla, cantidad: 2 },
    ]);
    const pedidoId = await vender([{ articuloId: packId, cantidad: 1 }]);

    await cancelar(pedidoId);

    expect(await stock(acondicionador, a01)).toBe(5);
    expect(await stock(mascarilla, a01)).toBe(5);
  });

  it('E11-H7 · bodega fuera de la venta online: la disponibilidad no cuenta su stock y la venta no lo descuenta', async () => {
    const formatoId = await nuevoFormato();
    // A-00 tiene el código menor, pero su bodega no abastece la web
    await conStock(formatoId, fueraDeLinea, 50);
    await conStock(formatoId, a01, 2);

    expect((await stockVendible(prisma, [formatoId])).get(formatoId)).toBe(2);
    await expect(
      vender([{ articuloId: formatoId, cantidad: 3 }]),
    ).rejects.toBeInstanceOf(ConflictException);

    await vender([{ articuloId: formatoId, cantidad: 2 }]);
    expect(await stock(formatoId, fueraDeLinea)).toBe(50);
    expect(await stock(formatoId, a01)).toBe(0);
  });

  it('E11-H7 · descuento por venta: se salta una ubicación desactivada aunque tenga el código menor', async () => {
    const formatoId = await nuevoFormato();
    await conStock(formatoId, a01, 5);
    await conStock(formatoId, a02, 5);
    await prisma.ubicacion.update({
      where: { id: a01 },
      data: { activa: false },
    });

    await vender([{ articuloId: formatoId, cantidad: 2 }]);

    expect(await stock(formatoId, a01)).toBe(5);
    expect(await stock(formatoId, a02)).toBe(3);
  });

  it('E11-H7 · reingreso por cancelación: vuelve a la ubicación de origen aunque se haya desactivado después', async () => {
    const formatoId = await nuevoFormato();
    await conStock(formatoId, a01, 3);
    const pedidoId = await vender([{ articuloId: formatoId, cantidad: 3 }]);
    await prisma.ubicacion.update({
      where: { id: a01 },
      data: { activa: false },
    });

    await cancelar(pedidoId);

    expect(await stock(formatoId, a01)).toBe(3);
  });

  it('RNF-13 · dos ventas simultáneas de la última unidad: solo una la descuenta', async () => {
    const formatoId = await nuevoFormato();
    await conStock(formatoId, a01, 1);

    const resultados = await Promise.allSettled([
      vender([{ articuloId: formatoId, cantidad: 1 }]),
      vender([{ articuloId: formatoId, cantidad: 1 }]),
    ]);

    expect(resultados.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const rechazo = resultados.find((r) => r.status === 'rejected');
    expect(rechazo?.reason).toBeInstanceOf(ConflictException);
    expect(await stock(formatoId, a01)).toBe(0);
  });

  it('RNF-13 · ventas cruzadas de dos formatos y transferencias simultáneas: no se bloquean entre sí', async () => {
    const uno = await nuevoFormato();
    const otro = await nuevoFormato();
    await conStock(uno, a01, 20);
    await conStock(uno, a02, 20);
    await conStock(otro, a01, 20);

    const transferir = () =>
      prisma.$transaction(async (tx) => {
        // Mismo orden de bloqueo que las transferencias de E11-H4 (id de ubicación)
        await tx.existencia.updateMany({
          where: { formatoId: uno, ubicacionId: a02, cantidad: { gte: 1 } },
          data: { cantidad: { decrement: 1 } },
        });
        await tx.existencia.update({
          where: {
            formatoId_ubicacionId: { formatoId: uno, ubicacionId: a01 },
          },
          data: { cantidad: { increment: 1 } },
        });
      });
    await Promise.all([
      vender([
        { articuloId: uno, cantidad: 1 },
        { articuloId: otro, cantidad: 1 },
      ]),
      vender([
        { articuloId: otro, cantidad: 1 },
        { articuloId: uno, cantidad: 1 },
      ]),
      transferir(),
      transferir(),
    ]);

    const total = async (formatoId: number) =>
      (
        await prisma.existencia.aggregate({
          where: { formatoId },
          _sum: { cantidad: true },
        })
      )._sum.cantidad;
    expect(await total(uno)).toBe(38);
    expect(await total(otro)).toBe(18);
  });

  it('E11-H6 · descuento por venta: una venta que deja el formato bajo el mínimo avisa a bodega y administración', async () => {
    const admin = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Paula',
        apellido: 'Soto',
        email: `e2e-venta-stock-${randomUUID()}@prueba.cl`,
        contrasenaHash: 'sin-uso',
        rol: ROLES.ADMINISTRADOR,
        fechaVerificacionCorreo: new Date(),
      },
    });
    try {
      const formatoId = await nuevoFormato(5);
      await conStock(formatoId, a01, 6);

      await vender([{ articuloId: formatoId, cantidad: 2 }]);

      const avisos = await prisma.notificacion.findMany({
        where: { tipo: TIPOS_NOTIFICACION.STOCK_BAJO, usuarioId: admin.id },
      });
      expect(avisos).toHaveLength(1);
    } finally {
      await prisma.notificacion.deleteMany({ where: { usuarioId: admin.id } });
      await prisma.usuario.delete({ where: { id: admin.id } });
    }
  });
});
