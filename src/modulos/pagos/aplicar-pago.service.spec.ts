import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Queue } from 'bullmq';
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
        { id: 40, estado: 'pendiente_pago', montoTotal: TOTAL, compradorId: 5 },
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
    usuario: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ email: 'marcela@prueba.cl', nombre: 'Marcela' }),
    },
    notificacion: { create: vi.fn().mockResolvedValue({ id: 77 }) },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((fn: (t: typeof db) => Promise<unknown>) =>
    fn(db),
  );
  return db;
};

describe('AplicarPagoService', () => {
  let db: ReturnType<typeof crearDb>;
  let correos: { add: ReturnType<typeof vi.fn> };
  let servicio: AplicarPagoService;

  const sinCambios = () => {
    expect(db.pago.create).not.toHaveBeenCalled();
    expect(db.pago.update).not.toHaveBeenCalled();
    expect(db.historialEstadoPedido.create).not.toHaveBeenCalled();
    expect(db.pedido.update).not.toHaveBeenCalled();
    expect(db.notificacion.create).not.toHaveBeenCalled();
    expect(correos.add).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    db = crearDb();
    correos = { add: vi.fn().mockResolvedValue({}) };
    servicio = new AplicarPagoService(
      db as unknown as PrismaService,
      correos as unknown as Queue,
    );
  });

  it('E6-H2 · pago aprobado: deja la NOTIFICACION en la transacción y encola el correo después del commit', async () => {
    let enTransaccion = false;
    db.$transaction.mockImplementation(
      async (fn: (t: typeof db) => Promise<unknown>) => {
        enTransaccion = true;
        const resultado = await fn(db);
        enTransaccion = false;
        return resultado;
      },
    );
    correos.add.mockImplementation(() => {
      expect(enTransaccion).toBe(false);
      return Promise.resolve({});
    });

    await servicio.aplicar(pagoMp());

    expect(db.notificacion.create.mock.calls[0][0].data).toEqual({
      usuarioId: 5,
      pedidoId: 40,
      tipo: 'pago_confirmado',
      asunto: `Recibimos el pago de tu pedido ${CODIGO}`,
      estadoEnvio: 'pendiente',
    });
    expect(correos.add).toHaveBeenCalledTimes(1);
    expect(correos.add.mock.calls[0].slice(0, 2)).toEqual([
      'pago-confirmado',
      {
        notificacionId: 77,
        destinatario: 'marcela@prueba.cl',
        nombre: 'Marcela',
        codigoPedido: CODIGO,
        montoTotal: TOTAL,
      },
    ]);
  });

  it('E6-H2 · Redis no responde al encolar: el pago se aplica igual (RNF-32)', async () => {
    correos.add.mockRejectedValue(new Error('Redis caído'));

    await expect(servicio.aplicar(pagoMp())).resolves.toBe('aprobado');
  });

  it('E6-H2 · pago rechazado o pendiente: no hay correo de confirmación', async () => {
    await servicio.aplicar(pagoMp({ estado: 'rechazado' }));

    expect(db.notificacion.create).not.toHaveBeenCalled();
    expect(correos.add).not.toHaveBeenCalled();
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
