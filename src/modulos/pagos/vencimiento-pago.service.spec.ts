import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CancelarPedidoService } from '../pedidos/cancelar-pedido.service.js';
import type { AplicarPagoService } from './aplicar-pago.service.js';
import type { PagoPasarela, PasarelaPago } from './pasarela-pago.js';
import { VencimientoPagoService } from './vencimiento-pago.service.js';

const CODIGO = 'AB12CD34EF56';

const pagoMp = (datos: Partial<PagoPasarela> = {}): PagoPasarela => ({
  idExterno: '1234567890',
  estado: 'aprobado',
  monto: 23800,
  moneda: 'CLP',
  codigoPedido: CODIGO,
  medioPago: 'visa',
  fechaAprobacion: new Date('2026-10-31T15:00:00Z'),
  ...datos,
});

describe('VencimientoPagoService', () => {
  let db: { pedido: { findMany: ReturnType<typeof vi.fn> } };
  let pasarela: { buscarPagosDePedido: ReturnType<typeof vi.fn> };
  let aplicarPago: { aplicar: ReturnType<typeof vi.fn> };
  let cancelarPedido: { cancelarPorImpago: ReturnType<typeof vi.fn> };
  let servicio: VencimientoPagoService;

  beforeEach(() => {
    db = {
      pedido: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 40, codigoPublico: CODIGO }]),
      },
    };
    pasarela = { buscarPagosDePedido: vi.fn().mockResolvedValue([]) };
    aplicarPago = { aplicar: vi.fn().mockResolvedValue('aprobado') };
    cancelarPedido = { cancelarPorImpago: vi.fn().mockResolvedValue(true) };
    servicio = new VencimientoPagoService(
      db as unknown as PrismaService,
      pasarela as unknown as PasarelaPago,
      aplicarPago as unknown as AplicarPagoService,
      cancelarPedido as unknown as CancelarPedidoService,
    );
  });

  it('E6-H3 · plazo vencido: cancela el pedido sin pagos y solo busca pendientes con la fecha vencida', async () => {
    await servicio.cancelarVencidos();

    expect(db.pedido.findMany.mock.calls[0][0].where).toEqual({
      estadoActual: 'pendiente_pago',
      fechaExpiracionPago: { lte: expect.any(Date) },
    });
    expect(pasarela.buscarPagosDePedido).toHaveBeenCalledWith(CODIGO);
    expect(cancelarPedido.cancelarPorImpago).toHaveBeenCalledWith(40);
  });

  it('E6-H3 · plazo vencido: un intento rechazado o pendiente no cuenta como pago', async () => {
    pasarela.buscarPagosDePedido.mockResolvedValue([
      pagoMp({ estado: 'rechazado' }),
      pagoMp({ estado: 'pendiente' }),
    ]);

    await servicio.cancelarVencidos();

    expect(aplicarPago.aplicar).not.toHaveBeenCalled();
    expect(cancelarPedido.cancelarPorImpago).toHaveBeenCalledWith(40);
  });

  it('E6-H3 · pago dentro del plazo: sin pedidos vencidos pendientes no consulta ni cancela nada', async () => {
    db.pedido.findMany.mockResolvedValue([]);

    await servicio.cancelarVencidos();

    expect(pasarela.buscarPagosDePedido).not.toHaveBeenCalled();
    expect(cancelarPedido.cancelarPorImpago).not.toHaveBeenCalled();
  });

  it('RNF-29 · pago aprobado sin notificar: lo aplica antes de intentar cancelar', async () => {
    const pago = pagoMp();
    pasarela.buscarPagosDePedido.mockResolvedValue([pago]);

    await servicio.cancelarVencidos();

    expect(aplicarPago.aplicar).toHaveBeenCalledWith(pago);
    expect(aplicarPago.aplicar.mock.invocationCallOrder[0]).toBeLessThan(
      cancelarPedido.cancelarPorImpago.mock.invocationCallOrder[0],
    );
  });

  it('RNF-29 · un pago que dice ser de otro pedido no se aplica', async () => {
    pasarela.buscarPagosDePedido.mockResolvedValue([
      pagoMp({ codigoPedido: 'OTRO00000000' }),
    ]);

    await servicio.cancelarVencidos();

    expect(aplicarPago.aplicar).not.toHaveBeenCalled();
  });

  it.each([
    ['otro monto', new BadRequestException('monto')],
    ['segundo pago', new ConflictException('ya pagado')],
  ])(
    'E6-H3 · pago aprobado que no se puede aplicar (%s): sigue y cancela',
    async (_caso, error) => {
      pasarela.buscarPagosDePedido.mockResolvedValue([pagoMp()]);
      aplicarPago.aplicar.mockRejectedValue(error);

      await servicio.cancelarVencidos();

      expect(cancelarPedido.cancelarPorImpago).toHaveBeenCalledWith(40);
    },
  );

  it('E6-H3 · Mercado Pago no responde: no cancela y corta la pasada', async () => {
    db.pedido.findMany.mockResolvedValue([
      { id: 40, codigoPublico: CODIGO },
      { id: 41, codigoPublico: 'ZZ12CD34EF56' },
    ]);
    pasarela.buscarPagosDePedido.mockRejectedValue(
      new ServiceUnavailableException('sin respuesta'),
    );

    await expect(servicio.cancelarVencidos()).resolves.toBeUndefined();

    expect(pasarela.buscarPagosDePedido).toHaveBeenCalledTimes(1);
    expect(cancelarPedido.cancelarPorImpago).not.toHaveBeenCalled();
  });

  it('E6-H3 · un pago que falla por la base: no cancela ese pedido y sigue con el siguiente', async () => {
    db.pedido.findMany.mockResolvedValue([
      { id: 40, codigoPublico: CODIGO },
      { id: 41, codigoPublico: 'ZZ12CD34EF56' },
    ]);
    pasarela.buscarPagosDePedido
      .mockResolvedValueOnce([pagoMp()])
      .mockResolvedValueOnce([]);
    aplicarPago.aplicar.mockRejectedValue(new Error('base caída'));

    await servicio.cancelarVencidos();

    expect(cancelarPedido.cancelarPorImpago).toHaveBeenCalledTimes(1);
    expect(cancelarPedido.cancelarPorImpago).toHaveBeenCalledWith(41);
  });

  it('E6-H3 · el stock de un pedido no se puede devolver: sigue con el siguiente', async () => {
    db.pedido.findMany.mockResolvedValue([
      { id: 40, codigoPublico: CODIGO },
      { id: 41, codigoPublico: 'ZZ12CD34EF56' },
    ]);
    cancelarPedido.cancelarPorImpago.mockRejectedValueOnce(
      new ConflictException('No se pudo devolver el stock del pedido.'),
    );

    await expect(servicio.cancelarVencidos()).resolves.toBeUndefined();

    expect(cancelarPedido.cancelarPorImpago).toHaveBeenCalledWith(41);
  });
});
