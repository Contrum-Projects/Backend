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
}));

vi.mock('mercadopago', async (original) => ({
  ...(await original<typeof import('mercadopago')>()),
  Preference: vi.fn(function () {
    return { create: sdk.crear };
  }),
  Payment: vi.fn(function () {
    return { get: sdk.consultar };
  }),
}));

const CODIGO = 'AB12CD34EF56';
const PAGAR_HASTA = new Date('2026-10-30T15:15:00Z');

describe('PasarelaMercadoPago', () => {
  let pasarela: PasarelaMercadoPago;

  beforeEach(() => {
    sdk.crear.mockReset();
    sdk.consultar.mockReset();
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
});
