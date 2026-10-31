import { ServiceUnavailableException } from '@nestjs/common';
import { MPNotFoundError } from 'mercadopago';
import {
  PASARELA_NO_CONFIGURADA,
  PASARELA_NO_RESPONDE,
  PasarelaMercadoPago,
  PasarelaNoConfigurada,
} from './pasarela-mercado-pago.js';

const sdk = vi.hoisted(() => ({
  crear: vi.fn(),
  consultar: vi.fn(),
  buscar: vi.fn(),
}));

vi.mock('mercadopago', async (original) => ({
  ...(await original<typeof import('mercadopago')>()),
  Preference: vi.fn(function () {
    return { create: sdk.crear };
  }),
  Payment: vi.fn(function () {
    return { get: sdk.consultar, search: sdk.buscar };
  }),
}));

const CODIGO = 'AB12CD34EF56';
const PAGAR_HASTA = new Date('2026-10-30T15:15:00Z');

describe('PasarelaMercadoPago', () => {
  let pasarela: PasarelaMercadoPago;

  beforeEach(() => {
    sdk.crear.mockReset();
    sdk.consultar.mockReset();
    sdk.buscar.mockReset();
    pasarela = new PasarelaMercadoPago('TEST-token');
  });

  it('E6-H1 · cobra el pedido entero por su total en pesos, con su código y hasta el fin del plazo', async () => {
    sdk.crear.mockResolvedValue({ init_point: 'https://mp.cl/pagar' });

    const url = await pasarela.crearCobro({
      codigoPedido: CODIGO,
      montoTotal: 23800,
      pagarHasta: PAGAR_HASTA,
      urlRegreso: `https://tienda.cl/pedidos/${CODIGO}/pago`,
    });

    expect(url).toBe('https://mp.cl/pagar');
    const cuerpo = sdk.crear.mock.calls[0][0].body;
    expect(cuerpo).toMatchObject({
      items: [
        { id: CODIGO, quantity: 1, unit_price: 23800, currency_id: 'CLP' },
      ],
      external_reference: CODIGO,
      binary_mode: true,
      expires: true,
      expiration_date_to: PAGAR_HASTA.toISOString(),
      auto_return: 'approved',
    });
    expect(cuerpo.back_urls.failure).toBe(
      `https://tienda.cl/pedidos/${CODIGO}/pago`,
    );
  });

  it('sin https no pide el regreso automático (Mercado Pago lo rechazaría)', async () => {
    sdk.crear.mockResolvedValue({ init_point: 'https://mp.cl/pagar' });

    await pasarela.crearCobro({
      codigoPedido: CODIGO,
      montoTotal: 23800,
      pagarHasta: PAGAR_HASTA,
      urlRegreso: 'http://localhost:3001/pedidos/x/pago',
    });

    expect(sdk.crear.mock.calls[0][0].body.auto_return).toBeUndefined();
  });

  it('Mercado Pago no responde al cobrar: 503', async () => {
    sdk.crear.mockRejectedValue(new Error('timeout'));

    await expect(
      pasarela.crearCobro({
        codigoPedido: CODIGO,
        montoTotal: 1,
        pagarHasta: PAGAR_HASTA,
        urlRegreso: 'https://tienda.cl',
      }),
    ).rejects.toThrow(new ServiceUnavailableException(PASARELA_NO_RESPONDE));
  });

  it('E6-H1 · traduce el pago sin datos de la tarjeta: solo approved aprueba', async () => {
    const casos: [string | undefined, string][] = [
      ['approved', 'aprobado'],
      ['rejected', 'rechazado'],
      ['cancelled', 'rechazado'],
      ['in_process', 'pendiente'],
      ['pending', 'pendiente'],
      ['refunded', 'pendiente'],
      [undefined, 'pendiente'],
    ];
    for (const [status, estado] of casos) {
      sdk.consultar.mockResolvedValue({
        id: 1234567890,
        status,
        transaction_amount: 23800,
        currency_id: 'CLP',
        external_reference: CODIGO,
        payment_method_id: 'visa',
        date_approved: '2026-10-30T15:00:00.000-03:00',
        card: { first_six_digits: '450995', last_four_digits: '3704' },
      });

      const pago = await pasarela.consultarPago('1234567890');

      expect(pago).toEqual({
        idExterno: '1234567890',
        estado,
        monto: 23800,
        moneda: 'CLP',
        codigoPedido: CODIGO,
        medioPago: 'visa',
        fechaAprobacion: new Date('2026-10-30T18:00:00.000Z'),
      });
    }
  });

  it('pago que no existe en Mercado Pago: null', async () => {
    sdk.consultar.mockRejectedValue(
      new MPNotFoundError({ message: 'not found', status: 404 } as never),
    );

    await expect(pasarela.consultarPago('1')).resolves.toBeNull();
  });

  it('Mercado Pago no responde al consultar: 503', async () => {
    sdk.consultar.mockRejectedValue(new Error('ECONNRESET'));

    await expect(pasarela.consultarPago('1')).rejects.toThrow(
      new ServiceUnavailableException(PASARELA_NO_RESPONDE),
    );
  });

  it('E6-H3 · busca los pagos por el código del pedido y recorre todas las páginas', async () => {
    sdk.buscar
      .mockResolvedValueOnce({
        paging: { total: 2 },
        results: [{ id: 1, status: 'rejected', external_reference: CODIGO }],
      })
      .mockResolvedValueOnce({
        paging: { total: 2 },
        results: [
          {
            id: 2,
            status: 'approved',
            transaction_amount: 23800,
            currency_id: 'CLP',
            external_reference: CODIGO,
            payment_method_id: 'visa',
            date_approved: '2026-10-30T15:00:00.000-03:00',
          },
        ],
      });

    const pagos = await pasarela.buscarPagosDePedido(CODIGO);

    expect(sdk.buscar.mock.calls.map((c) => c[0].options)).toEqual([
      { external_reference: CODIGO, limit: 100, offset: 0 },
      { external_reference: CODIGO, limit: 100, offset: 1 },
    ]);
    expect(pagos.map((p) => [p.idExterno, p.estado])).toEqual([
      ['1', 'rechazado'],
      ['2', 'aprobado'],
    ]);
    expect(pagos[1]).toMatchObject({
      monto: 23800,
      moneda: 'CLP',
      codigoPedido: CODIGO,
    });
  });

  it('E6-H3 · pedido sin pagos en Mercado Pago: lista vacía', async () => {
    sdk.buscar.mockResolvedValue({ paging: { total: 0 }, results: [] });

    await expect(pasarela.buscarPagosDePedido(CODIGO)).resolves.toEqual([]);
  });

  it.each([
    ['sin la lista de resultados', { paging: { total: 0 } }],
    [
      'con un pago sin id',
      { paging: { total: 1 }, results: [{ status: 'approved' }] },
    ],
  ])(
    'E6-H3 · búsqueda incompleta (%s): 503 para no cancelar a ciegas',
    async (_caso, respuesta) => {
      sdk.buscar.mockResolvedValue(respuesta);

      await expect(pasarela.buscarPagosDePedido(CODIGO)).rejects.toThrow(
        new ServiceUnavailableException(PASARELA_NO_RESPONDE),
      );
    },
  );

  it('E6-H3 · Mercado Pago no responde al buscar: 503', async () => {
    sdk.buscar.mockRejectedValue(new Error('ECONNRESET'));

    await expect(pasarela.buscarPagosDePedido(CODIGO)).rejects.toThrow(
      new ServiceUnavailableException(PASARELA_NO_RESPONDE),
    );
  });
});

describe('PasarelaNoConfigurada', () => {
  it('sin token de Mercado Pago: pagar responde 503', async () => {
    const pasarela = new PasarelaNoConfigurada();

    await expect(pasarela.consultarPago()).rejects.toThrow(
      new ServiceUnavailableException(PASARELA_NO_CONFIGURADA),
    );
    await expect(pasarela.crearCobro()).rejects.toThrow(
      new ServiceUnavailableException(PASARELA_NO_CONFIGURADA),
    );
  });

  it('E6-H3 · sin token de Mercado Pago: la búsqueda responde 503 para no cancelar a ciegas', async () => {
    await expect(
      new PasarelaNoConfigurada().buscarPagosDePedido(),
    ).rejects.toThrow(new ServiceUnavailableException(PASARELA_NO_CONFIGURADA));
  });
});
