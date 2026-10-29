import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { VentaStockService } from '../inventario/venta-stock.service.js';
import {
  CancelarPedidoService,
  SOLO_PENDIENTE_DE_PAGO,
} from './cancelar-pedido.service.js';

const PERSONAL = '3f0c2a52-0b9e-4c55-9d0e-6a3a4f6d1b2c';
const CODIGO = 'AB12CD34EF56';

const crearDb = () => {
  const db = {
    $queryRaw: vi
      .fn()
      .mockResolvedValue([{ id: 40, estado: 'pendiente_pago' }]),
    usuario: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 7 }) },
    historialEstadoPedido: {
      aggregate: vi.fn().mockResolvedValue({ _max: { correlativo: 1 } }),
      create: vi.fn().mockResolvedValue({}),
    },
    pedido: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((fn: (t: typeof db) => Promise<unknown>) =>
    fn(db),
  );
  return db;
};

describe('CancelarPedidoService', () => {
  let db: ReturnType<typeof crearDb>;
  let ventaStock: { reingresarPorPedido: ReturnType<typeof vi.fn> };
  let servicio: CancelarPedidoService;

  beforeEach(() => {
    db = crearDb();
    ventaStock = { reingresarPorPedido: vi.fn().mockResolvedValue([]) };
    servicio = new CancelarPedidoService(
      db as unknown as PrismaService,
      ventaStock as unknown as VentaStockService,
    );
  });

  it('E8-H3 · pedido pendiente de pago: devuelve su stock a nombre de quien cancela, registra el cambio y lo deja cancelado', async () => {
    const respuesta = await servicio.cancelar(PERSONAL, CODIGO, {
      comentario: 'Pedido duplicado.',
    });

    expect(respuesta).toEqual({ codigoPublico: CODIGO, estado: 'cancelado' });
    expect(db.usuario.findUniqueOrThrow.mock.calls[0][0].where).toEqual({
      codigoPublico: PERSONAL,
    });
    expect(ventaStock.reingresarPorPedido).toHaveBeenCalledWith(db, 40, 7);
    expect(db.historialEstadoPedido.create.mock.calls[0][0].data).toEqual({
      pedidoId: 40,
      correlativo: 2,
      usuarioId: 7,
      estado: 'cancelado',
      comentario: 'Pedido duplicado.',
    });
    expect(db.pedido.update.mock.calls[0][0]).toEqual({
      where: { id: 40 },
      data: { estadoActual: 'cancelado' },
    });
  });

  it('el primer cambio del historial lleva el correlativo 1 y el comentario puede faltar', async () => {
    db.historialEstadoPedido.aggregate.mockResolvedValue({
      _max: { correlativo: null },
    });

    await servicio.cancelar(PERSONAL, CODIGO, {});

    const datos = db.historialEstadoPedido.create.mock.calls[0][0].data;
    expect(datos.correlativo).toBe(1);
    expect(datos.comentario).toBeUndefined();
  });

  it('E8-H3 · pedido que no está pendiente de pago: 409 y no devuelve stock ni cambia nada', async () => {
    for (const estado of ['pagado', 'en_preparacion', 'cancelado']) {
      db.$queryRaw.mockResolvedValue([{ id: 40, estado }]);

      await expect(servicio.cancelar(PERSONAL, CODIGO, {})).rejects.toThrow(
        new ConflictException(SOLO_PENDIENTE_DE_PAGO),
      );
    }
    expect(ventaStock.reingresarPorPedido).not.toHaveBeenCalled();
    expect(db.historialEstadoPedido.create).not.toHaveBeenCalled();
    expect(db.pedido.update).not.toHaveBeenCalled();
  });

  it('pedido inexistente: 404', async () => {
    db.$queryRaw.mockResolvedValue([]);

    await expect(servicio.cancelar(PERSONAL, CODIGO, {})).rejects.toThrow(
      new NotFoundException('El pedido no existe.'),
    );
    expect(ventaStock.reingresarPorPedido).not.toHaveBeenCalled();
  });

  it('RNF-12 · si el reingreso falla, no registra el cambio ni cambia el estado (la transacción se revierte)', async () => {
    ventaStock.reingresarPorPedido.mockRejectedValue(
      new ConflictException('No se pudo devolver el stock del pedido.'),
    );

    await expect(servicio.cancelar(PERSONAL, CODIGO, {})).rejects.toThrow(
      ConflictException,
    );
    expect(db.historialEstadoPedido.create).not.toHaveBeenCalled();
    expect(db.pedido.update).not.toHaveBeenCalled();
  });
});
