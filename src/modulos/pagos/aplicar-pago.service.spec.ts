import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  AplicarPagoService,
  MONTO_NO_CORRESPONDE,
  PAGO_NO_CORRESPONDE,
  PEDIDO_CANCELADO,
  PEDIDO_YA_PAGADO,
} from './aplicar-pago.service.js';
import type { PagoPasarela } from './pasarela-pago.js';

const CODIGO = 'AB12CD34EF56';
const TOTAL = 23800;
const APROBADO_EN = new Date('2026-10-30T15:00:00Z');

const pagoMp = (datos: Partial<PagoPasarela> = {}): PagoPasarela => ({
  idExterno: '1234567890',
  estado: 'aprobado',
  monto: TOTAL,
  moneda: 'CLP',
  codigoPedido: CODIGO,
  medioPago: 'visa',
  fechaAprobacion: APROBADO_EN,
  ...datos,
});

const crearDb = () => {
  const db = {
    $queryRaw: vi
      .fn()
      .mockResolvedValue([
        { id: 40, estado: 'pendiente_pago', montoTotal: TOTAL },
      ]),
    pago: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
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

describe('AplicarPagoService', () => {
  let db: ReturnType<typeof crearDb>;
  let servicio: AplicarPagoService;

  const sinCambios = () => {
    expect(db.pago.create).not.toHaveBeenCalled();
    expect(db.pago.update).not.toHaveBeenCalled();
    expect(db.historialEstadoPedido.create).not.toHaveBeenCalled();
    expect(db.pedido.update).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    db = crearDb();
    servicio = new AplicarPagoService(db as unknown as PrismaService);
  });

  it('E6-H1 · pago aprobado: registra el pago por el total sin datos de la tarjeta y deja el pedido pagado', async () => {
    const estado = await servicio.aplicar(pagoMp());

    expect(estado).toBe('aprobado');
    expect(db.pago.create.mock.calls[0][0].data).toEqual({
      pedidoId: 40,
      idTransaccionExterna: '1234567890',
      monto: TOTAL,
      estado: 'aprobado',
      fechaPago: APROBADO_EN,
      medioPago: 'visa',
    });
    expect(db.historialEstadoPedido.create.mock.calls[0][0].data).toEqual({
      pedidoId: 40,
      correlativo: 2,
      usuarioId: null,
      estado: 'pagado',
    });
    expect(db.pedido.update.mock.calls[0][0]).toEqual({
      where: { id: 40 },
      data: { estadoActual: 'pagado' },
    });
  });

  it('E6-H1 · pago aprobado de un intento que estaba pendiente: actualiza ese mismo pago', async () => {
    db.pago.findUnique.mockResolvedValue({
      id: 9,
      pedidoId: 40,
      estado: 'pendiente',
    });

    await servicio.aplicar(pagoMp());

    expect(db.pago.create).not.toHaveBeenCalled();
    expect(db.pago.update.mock.calls[0][0]).toEqual({
      where: { id: 9 },
      data: {
        monto: TOTAL,
        estado: 'aprobado',
        fechaPago: APROBADO_EN,
        medioPago: 'visa',
      },
    });
    expect(db.pedido.update).toHaveBeenCalled();
  });

  it('E6-H1 · pago rechazado: registra el intento y deja el pedido pendiente de pago', async () => {
    const estado = await servicio.aplicar(
      pagoMp({ estado: 'rechazado', fechaAprobacion: null }),
    );

    expect(estado).toBe('rechazado');
    expect(db.pago.create.mock.calls[0][0].data).toMatchObject({
      pedidoId: 40,
      estado: 'rechazado',
      fechaPago: null,
    });
    expect(db.historialEstadoPedido.create).not.toHaveBeenCalled();
    expect(db.pedido.update).not.toHaveBeenCalled();
  });

  it('E6-H1 · pago pendiente en Mercado Pago: el pedido sigue esperando el pago', async () => {
    const estado = await servicio.aplicar(
      pagoMp({ estado: 'pendiente', fechaAprobacion: null }),
    );

    expect(estado).toBe('pendiente');
    expect(db.pedido.update).not.toHaveBeenCalled();
  });

  it('E6-H1 · pedido ya pagado: no acepta un segundo pago aprobado', async () => {
    db.$queryRaw.mockResolvedValue([
      { id: 40, estado: 'pagado', montoTotal: TOTAL },
    ]);

    await expect(
      servicio.aplicar(pagoMp({ idExterno: '999' })),
    ).rejects.toThrow(new ConflictException(PEDIDO_YA_PAGADO));
    sinCambios();
  });

  it('E6-H1 · el mismo pago aprobado dos veces: no cambia nada la segunda vez', async () => {
    db.$queryRaw.mockResolvedValue([
      { id: 40, estado: 'pagado', montoTotal: TOTAL },
    ]);
    db.pago.findUnique.mockResolvedValue({
      id: 9,
      pedidoId: 40,
      estado: 'aprobado',
    });

    await expect(servicio.aplicar(pagoMp())).resolves.toBe('aprobado');
    sinCambios();
  });

  it('pago aprobado por un monto distinto del total: 400 y el pedido no cambia', async () => {
    await expect(
      servicio.aplicar(pagoMp({ monto: TOTAL - 1 })),
    ).rejects.toThrow(new BadRequestException(MONTO_NO_CORRESPONDE));
    await expect(servicio.aplicar(pagoMp({ moneda: 'USD' }))).rejects.toThrow(
      new BadRequestException(MONTO_NO_CORRESPONDE),
    );
    sinCambios();
  });

  it('pago aprobado de un pedido cancelado: 409 y no lo reabre', async () => {
    db.$queryRaw.mockResolvedValue([
      { id: 40, estado: 'cancelado', montoTotal: TOTAL },
    ]);

    await expect(servicio.aplicar(pagoMp())).rejects.toThrow(
      new ConflictException(PEDIDO_CANCELADO),
    );
    sinCambios();
  });

  it('RNF-29 · pago aprobado con el plazo vencido y el pedido aún pendiente: se aplica', async () => {
    // El servicio no mira la fecha: solo que el pedido siga pendiente de pago
    await expect(servicio.aplicar(pagoMp())).resolves.toBe('aprobado');
    expect(db.pedido.update).toHaveBeenCalled();
  });

  it('pago sin pedido, de un pedido que no existe o ya registrado en otro pedido: 400', async () => {
    await expect(
      servicio.aplicar(pagoMp({ codigoPedido: null })),
    ).rejects.toThrow(new BadRequestException(PAGO_NO_CORRESPONDE));

    db.$queryRaw.mockResolvedValueOnce([]);
    await expect(servicio.aplicar(pagoMp())).rejects.toThrow(
      new BadRequestException(PAGO_NO_CORRESPONDE),
    );

    db.pago.findUnique.mockResolvedValue({
      id: 9,
      pedidoId: 41,
      estado: 'pendiente',
    });
    await expect(servicio.aplicar(pagoMp())).rejects.toThrow(
      new BadRequestException(PAGO_NO_CORRESPONDE),
    );
    sinCambios();
  });
});
