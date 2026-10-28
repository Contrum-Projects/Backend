import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { StockBajoService } from './stock-bajo.service.js';
import { VentaStockService } from './venta-stock.service.js';

const PEDIDO = 500;

const crearTx = () => ({
  $queryRaw: vi.fn().mockResolvedValue([]),
  $executeRaw: vi.fn().mockResolvedValue(1),
  articuloVenta: {
    findMany: vi
      .fn()
      .mockResolvedValue([{ id: 11, tipo: 'formato', pack: null }]),
  },
  existencia: {
    findMany: vi.fn().mockResolvedValue([
      { ubicacionId: 7, cantidad: 2 },
      { ubicacionId: 3, cantidad: 10 },
    ]),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  formatoProducto: {
    findUnique: vi.fn().mockResolvedValue({
      nombreFormato: '300 ml',
      producto: { nombre: 'Shampoo Reparador' },
    }),
  },
  movimientoInventario: {
    create: vi.fn().mockResolvedValue({ id: 1 }),
    groupBy: vi.fn().mockResolvedValue([]),
  },
});

describe('VentaStockService', () => {
  let tx: ReturnType<typeof crearTx>;
  let stockBajo: {
    stockAntes: ReturnType<typeof vi.fn>;
    avisarSiCruza: ReturnType<typeof vi.fn>;
    encolar: ReturnType<typeof vi.fn>;
  };
  let servicio: VentaStockService;

  const comoTx = () => tx as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    tx = crearTx();
    stockBajo = {
      stockAntes: vi.fn().mockResolvedValue(12),
      avisarSiCruza: vi.fn().mockResolvedValue([]),
      encolar: vi.fn().mockResolvedValue(undefined),
    };
    servicio = new VentaStockService(stockBajo as unknown as StockBajoService);
  });

  describe('descontarPorPedido', () => {
    it('E11-H7 · descuento por venta: descuenta siguiendo el orden del código de ubicación y deja un movimiento por ubicación ligado al pedido', async () => {
      const { descuentos } = await servicio.descontarPorPedido(
        comoTx(),
        PEDIDO,
        [{ articuloId: 11, cantidad: 5 }],
      );

      // Las existencias llegan ya ordenadas por código (y por id para desempatar)
      expect(tx.existencia.findMany).toHaveBeenCalledWith({
        where: {
          formatoId: 11,
          cantidad: { gt: 0 },
          ubicacion: {
            activa: true,
            bodega: { activa: true, abasteceVentaOnline: true },
          },
        },
        orderBy: [{ ubicacion: { codigo: 'asc' } }, { ubicacionId: 'asc' }],
        select: { ubicacionId: true, cantidad: true },
      });
      // Primero agota la primera ubicación (2) y el resto (3) sale de la siguiente
      expect(tx.existencia.updateMany.mock.calls).toEqual([
        [
          {
            where: { formatoId: 11, ubicacionId: 7, cantidad: { gte: 2 } },
            data: { cantidad: { decrement: 2 } },
          },
        ],
        [
          {
            where: { formatoId: 11, ubicacionId: 3, cantidad: { gte: 3 } },
            data: { cantidad: { decrement: 3 } },
          },
        ],
      ]);
      expect(tx.movimientoInventario.create.mock.calls).toEqual([
        [
          {
            data: {
              formatoId: 11,
              ubicacionOrigenId: 7,
              pedidoId: PEDIDO,
              tipo: 'venta',
              cantidad: 2,
            },
          },
        ],
        [
          {
            data: {
              formatoId: 11,
              ubicacionOrigenId: 3,
              pedidoId: PEDIDO,
              tipo: 'venta',
              cantidad: 3,
            },
          },
        ],
      ]);
      expect(descuentos).toEqual([
        { formatoId: 11, ubicacionId: 7, cantidad: 2 },
        { formatoId: 11, ubicacionId: 3, cantidad: 3 },
      ]);
    });

    it('E11-H7 · descuento por venta: si la primera ubicación alcanza, no toca las demás', async () => {
      await servicio.descontarPorPedido(comoTx(), PEDIDO, [
        { articuloId: 11, cantidad: 2 },
      ]);

      expect(tx.existencia.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.movimientoInventario.create).toHaveBeenCalledTimes(1);
    });

    it('E11-H7 · descuento por venta: bloquea las existencias del formato en orden de id de ubicación antes de leerlas', async () => {
      await servicio.descontarPorPedido(comoTx(), PEDIDO, [
        { articuloId: 11, cantidad: 1 },
      ]);

      const [partes, formatoId] = tx.$queryRaw.mock.calls[0] as [
        string[],
        number,
      ];
      const sql = partes.join('?');
      // Mismo orden que las transferencias: dos operaciones cruzadas no se bloquean entre sí
      expect(sql).toContain('ORDER BY id_ubicacion');
      expect(sql).toContain('FOR UPDATE');
      expect(formatoId).toBe(11);
    });

    it('E11-H7 · descuento por venta: sin stock vendible suficiente responde 409 sin descontar nada', async () => {
      const venta = servicio.descontarPorPedido(comoTx(), PEDIDO, [
        { articuloId: 11, cantidad: 13 },
      ]);

      await expect(venta).rejects.toBeInstanceOf(ConflictException);
      await expect(venta).rejects.toThrow(
        'No hay stock suficiente de Shampoo Reparador 300 ml.',
      );
      expect(tx.existencia.updateMany).not.toHaveBeenCalled();
      expect(tx.movimientoInventario.create).not.toHaveBeenCalled();
    });

    it('RNF-13 · descuento por venta: si la condición atómica no se cumple, responde 409', async () => {
      tx.existencia.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        servicio.descontarPorPedido(comoTx(), PEDIDO, [
          { articuloId: 11, cantidad: 1 },
        ]),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.movimientoInventario.create).not.toHaveBeenCalled();
    });

    it('E11-H6 · descuento por venta: revisa el stock mínimo de cada formato y devuelve los avisos', async () => {
      const aviso = { notificacionId: 70 };
      stockBajo.avisarSiCruza.mockResolvedValue([aviso]);

      const { avisos } = await servicio.descontarPorPedido(comoTx(), PEDIDO, [
        { articuloId: 11, cantidad: 1 },
      ]);

      expect(stockBajo.stockAntes).toHaveBeenCalledWith(tx, 11);
      expect(stockBajo.avisarSiCruza).toHaveBeenCalledWith(tx, 11, 12);
      expect(avisos).toEqual([aviso]);
    });

    it('E11-H7 · pack vendido: descuenta cada formato componente por la cantidad del pack', async () => {
      tx.articuloVenta.findMany.mockResolvedValue([
        {
          id: 40,
          tipo: 'pack',
          pack: {
            componentes: [
              { formatoId: 12, cantidad: 2 },
              { formatoId: 11, cantidad: 1 },
            ],
          },
        },
      ]);

      const { descuentos } = await servicio.descontarPorPedido(
        comoTx(),
        PEDIDO,
        [{ articuloId: 40, cantidad: 3 }],
      );

      // Formatos en orden de id (bloqueos en un orden fijo): 11 × 3 y 12 × 2 × 3
      expect(stockBajo.stockAntes.mock.calls.map(([, id]) => id)).toEqual([
        11, 12,
      ]);
      expect(
        descuentos.reduce<Record<number, number>>(
          (total, d) => ({
            ...total,
            [d.formatoId]: (total[d.formatoId] ?? 0) + d.cantidad,
          }),
          {},
        ),
      ).toEqual({ 11: 3, 12: 6 });
    });

    it('E11-H7 · pack vendido: un formato que llega suelto y dentro de un pack se descuenta una vez por el total', async () => {
      tx.articuloVenta.findMany.mockResolvedValue([
        { id: 11, tipo: 'formato', pack: null },
        {
          id: 40,
          tipo: 'pack',
          pack: { componentes: [{ formatoId: 11, cantidad: 2 }] },
        },
      ]);

      await servicio.descontarPorPedido(comoTx(), PEDIDO, [
        { articuloId: 11, cantidad: 1 },
        { articuloId: 40, cantidad: 2 },
      ]);

      expect(stockBajo.stockAntes).toHaveBeenCalledTimes(1);
      expect(
        tx.movimientoInventario.create.mock.calls.reduce(
          (total, [{ data }]) =>
            total + (data as { cantidad: number }).cantidad,
          0,
        ),
      ).toBe(5);
    });

    it('E11-H7 · descuento por venta: un artículo inexistente responde 409', async () => {
      tx.articuloVenta.findMany.mockResolvedValue([]);

      await expect(
        servicio.descontarPorPedido(comoTx(), PEDIDO, [
          { articuloId: 99, cantidad: 1 },
        ]),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('descontarPorPedido · validación', () => {
    it('E11-H7 · pack vendido: un pack sin componentes responde 409 y no se trata como formato', async () => {
      tx.articuloVenta.findMany.mockResolvedValue([
        { id: 40, tipo: 'pack', pack: null },
      ]);

      await expect(
        servicio.descontarPorPedido(comoTx(), PEDIDO, [
          { articuloId: 40, cantidad: 1 },
        ]),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(stockBajo.stockAntes).not.toHaveBeenCalled();
    });

    it.each([0, -5, 1.5, Number.NaN])(
      'E11-H7 · descuento por venta: una cantidad %s responde 400 sin tocar el stock',
      async (cantidad) => {
        await expect(
          servicio.descontarPorPedido(comoTx(), PEDIDO, [
            { articuloId: 11, cantidad },
          ]),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(tx.articuloVenta.findMany).not.toHaveBeenCalled();
        expect(tx.existencia.updateMany).not.toHaveBeenCalled();
      },
    );

    it('E11-H7 · pack vendido: si las unidades de un formato pasarían el máximo de la columna, responde 400', async () => {
      tx.articuloVenta.findMany.mockResolvedValue([
        {
          id: 40,
          tipo: 'pack',
          pack: { componentes: [{ formatoId: 11, cantidad: 99 }] },
        },
      ]);

      await expect(
        servicio.descontarPorPedido(comoTx(), PEDIDO, [
          { articuloId: 40, cantidad: 2_000_000_000 },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.existencia.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('reingresarPorPedido', () => {
    const vendido = [
      { formatoId: 11, ubicacionOrigenId: 7, _sum: { cantidad: 2 } },
      { formatoId: 11, ubicacionOrigenId: 3, _sum: { cantidad: 3 } },
    ];

    it('E11-H7 · reingreso por cancelación: devuelve cada unidad a la ubicación de donde salió con un movimiento de reingreso', async () => {
      tx.movimientoInventario.groupBy
        .mockResolvedValueOnce(vendido)
        .mockResolvedValueOnce([]);

      const reingresos = await servicio.reingresarPorPedido(
        comoTx(),
        PEDIDO,
        9,
      );

      expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
      expect(tx.movimientoInventario.create.mock.calls).toEqual([
        [
          {
            data: {
              formatoId: 11,
              ubicacionDestinoId: 3,
              pedidoId: PEDIDO,
              usuarioId: 9,
              tipo: 'reingreso',
              cantidad: 3,
            },
          },
        ],
        [
          {
            data: {
              formatoId: 11,
              ubicacionDestinoId: 7,
              pedidoId: PEDIDO,
              usuarioId: 9,
              tipo: 'reingreso',
              cantidad: 2,
            },
          },
        ],
      ]);
      expect(reingresos).toEqual([
        { formatoId: 11, ubicacionId: 3, cantidad: 3 },
        { formatoId: 11, ubicacionId: 7, cantidad: 2 },
      ]);
    });

    it('E11-H7 · reingreso por cancelación: bloquea el pedido antes de calcular lo pendiente', async () => {
      await servicio.reingresarPorPedido(comoTx(), PEDIDO, null);

      const [partes, id] = tx.$queryRaw.mock.calls[0] as [string[], number];
      expect(partes.join('?')).toContain('FOR NO KEY UPDATE');
      expect(id).toBe(PEDIDO);
    });

    it('E11-H7 · reingreso por cancelación: lo ya reingresado no se devuelve otra vez', async () => {
      tx.movimientoInventario.groupBy
        .mockResolvedValueOnce(vendido)
        .mockResolvedValueOnce([
          { formatoId: 11, ubicacionDestinoId: 7, _sum: { cantidad: 2 } },
          { formatoId: 11, ubicacionDestinoId: 3, _sum: { cantidad: 3 } },
        ]);

      await expect(
        servicio.reingresarPorPedido(comoTx(), PEDIDO, null),
      ).resolves.toEqual([]);
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.movimientoInventario.create).not.toHaveBeenCalled();
    });

    it('E11-H7 · reingreso por cancelación: la cancelación automática deja el movimiento sin usuario', async () => {
      tx.movimientoInventario.groupBy
        .mockResolvedValueOnce([vendido[0]])
        .mockResolvedValueOnce([]);

      await servicio.reingresarPorPedido(comoTx(), PEDIDO, null);

      expect(tx.movimientoInventario.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ usuarioId: null }) as unknown,
      });
    });

    it('E11-H7 · reingreso por cancelación: si la suma pasaría el máximo de la columna, responde 409', async () => {
      tx.movimientoInventario.groupBy
        .mockResolvedValueOnce([vendido[0]])
        .mockResolvedValueOnce([]);
      tx.$executeRaw.mockResolvedValue(0);

      await expect(
        servicio.reingresarPorPedido(comoTx(), PEDIDO, null),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('E11-H6 · encolar: delega en el aviso de stock bajo', async () => {
    await servicio.encolarAvisos([]);

    expect(stockBajo.encolar).toHaveBeenCalledWith([]);
  });
});
