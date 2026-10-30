import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { MisPedidosService } from '../pedidos/mis-pedidos.service.js';
import {
  type AplicarPagoService,
  PAGO_NO_CORRESPONDE,
  PEDIDO_CANCELADO,
  PEDIDO_YA_PAGADO,
} from './aplicar-pago.service.js';
import { PagarPedidoService, PLAZO_VENCIDO } from './pagar-pedido.service.js';
import type { PagoPasarela, PasarelaPago } from './pasarela-pago.js';

const USUARIO = '3f0c2a52-0b9e-4c55-9d0e-6a3a4f6d1b2c';
const CODIGO = 'AB12CD34EF56';
const TOTAL = 23800;
const URL_PAGO = 'https://www.mercadopago.cl/checkout/v1/redirect?pref_id=1';

const enMinutos = (minutos: number) => new Date(Date.now() + minutos * 60_000);

const pagoMp = (datos: Partial<PagoPasarela> = {}): PagoPasarela => ({
  idExterno: '1234567890',
  estado: 'aprobado',
  monto: TOTAL,
  moneda: 'CLP',
  codigoPedido: CODIGO,
  medioPago: 'visa',
  fechaAprobacion: new Date('2026-10-30T15:00:00Z'),
  ...datos,
});

describe('PagarPedidoService', () => {
  let db: { pedido: { findFirst: ReturnType<typeof vi.fn> } };
  let pasarela: {
    crearCobro: ReturnType<typeof vi.fn>;
    consultarPago: ReturnType<typeof vi.fn>;
  };
  let aplicarPago: { aplicar: ReturnType<typeof vi.fn> };
  let misPedidos: { obtener: ReturnType<typeof vi.fn> };
  let servicio: PagarPedidoService;
  const pagarHasta = enMinutos(10);

  beforeEach(() => {
    db = {
      pedido: {
        findFirst: vi.fn().mockResolvedValue({
          id: 40,
          estadoActual: 'pendiente_pago',
          montoTotal: TOTAL,
          fechaExpiracionPago: pagarHasta,
        }),
      },
    };
    pasarela = {
      crearCobro: vi.fn().mockResolvedValue(URL_PAGO),
      consultarPago: vi.fn().mockResolvedValue(pagoMp()),
    };
    aplicarPago = { aplicar: vi.fn().mockResolvedValue('aprobado') };
    misPedidos = {
      obtener: vi.fn().mockResolvedValue({ codigoPublico: CODIGO }),
    };
    const config = {
      get: vi.fn().mockReturnValue('https://tienda.cl/'),
    } as unknown as ConfigService<Entorno, true>;
    servicio = new PagarPedidoService(
      db as unknown as PrismaService,
      config,
      pasarela as unknown as PasarelaPago,
      aplicarPago as unknown as AplicarPagoService,
      misPedidos as unknown as MisPedidosService,
    );
  });

  describe('iniciar', () => {
    it('E6-H1 · pedido pendiente y dentro del plazo: cobra el total y devuelve la URL de pago', async () => {
      const respuesta = await servicio.iniciar(USUARIO, CODIGO);

      expect(respuesta).toEqual({ urlPago: URL_PAGO, pagarHasta });
      expect(db.pedido.findFirst.mock.calls[0][0].where).toEqual({
        codigoPublico: CODIGO,
        usuario: { codigoPublico: USUARIO },
      });
      expect(pasarela.crearCobro).toHaveBeenCalledWith({
        codigoPedido: CODIGO,
        montoTotal: TOTAL,
        pagarHasta,
        urlRegreso: `https://tienda.cl/pedidos/${CODIGO}/pago`,
      });
    });

    it('E6-H1 · pedido ya pagado: 409 y no prepara otro cobro', async () => {
      for (const estadoActual of ['pagado', 'en_preparacion', 'entregado']) {
        db.pedido.findFirst.mockResolvedValue({
          estadoActual,
          montoTotal: TOTAL,
          fechaExpiracionPago: pagarHasta,
        });

        await expect(servicio.iniciar(USUARIO, CODIGO)).rejects.toThrow(
          new ConflictException(PEDIDO_YA_PAGADO),
        );
      }
      expect(pasarela.crearCobro).not.toHaveBeenCalled();
    });

    it('E6-H1 · pago rechazado y plazo vencido: ya no deja reintentar', async () => {
      db.pedido.findFirst.mockResolvedValue({
        estadoActual: 'pendiente_pago',
        montoTotal: TOTAL,
        fechaExpiracionPago: enMinutos(-1),
      });

      await expect(servicio.iniciar(USUARIO, CODIGO)).rejects.toThrow(
        new ConflictException(PLAZO_VENCIDO),
      );
      expect(pasarela.crearCobro).not.toHaveBeenCalled();
    });

    it('pedido cancelado: 409', async () => {
      db.pedido.findFirst.mockResolvedValue({
        estadoActual: 'cancelado',
        montoTotal: TOTAL,
        fechaExpiracionPago: pagarHasta,
      });

      await expect(servicio.iniciar(USUARIO, CODIGO)).rejects.toThrow(
        new ConflictException(PEDIDO_CANCELADO),
      );
    });

    it('pedido de otra cuenta o inexistente: 404', async () => {
      db.pedido.findFirst.mockResolvedValue(null);

      await expect(servicio.iniciar(USUARIO, CODIGO)).rejects.toThrow(
        new NotFoundException('El pedido no existe.'),
      );
      expect(pasarela.crearCobro).not.toHaveBeenCalled();
    });
  });

  describe('confirmar', () => {
    it('E6-H1 · pago aprobado: lo consulta a Mercado Pago, lo aplica y devuelve el pedido', async () => {
      const respuesta = await servicio.confirmar(USUARIO, CODIGO, '1234567890');

      expect(pasarela.consultarPago).toHaveBeenCalledWith('1234567890');
      expect(aplicarPago.aplicar).toHaveBeenCalledWith(pagoMp());
      expect(misPedidos.obtener).toHaveBeenCalledWith(USUARIO, CODIGO);
      expect(respuesta).toEqual({
        estadoPago: 'aprobado',
        pedido: { codigoPublico: CODIGO },
      });
    });

    it('E6-H1 · pago rechazado: informa el rechazo con el pedido aún pendiente', async () => {
      aplicarPago.aplicar.mockResolvedValue('rechazado');

      const respuesta = await servicio.confirmar(USUARIO, CODIGO, '1234567890');

      expect(respuesta.estadoPago).toBe('rechazado');
    });

    it('pago de otro pedido o que no existe en Mercado Pago: 400 y no aplica nada', async () => {
      pasarela.consultarPago.mockResolvedValueOnce(
        pagoMp({ codigoPedido: 'ZZZZZZZZZZZZ' }),
      );
      await expect(
        servicio.confirmar(USUARIO, CODIGO, '1234567890'),
      ).rejects.toThrow(new BadRequestException(PAGO_NO_CORRESPONDE));

      pasarela.consultarPago.mockResolvedValueOnce(null);
      await expect(
        servicio.confirmar(USUARIO, CODIGO, '1234567890'),
      ).rejects.toThrow(new BadRequestException(PAGO_NO_CORRESPONDE));
      expect(aplicarPago.aplicar).not.toHaveBeenCalled();
    });

    it('pedido de otra cuenta: 404 sin consultar a Mercado Pago', async () => {
      db.pedido.findFirst.mockResolvedValue(null);

      await expect(
        servicio.confirmar(USUARIO, CODIGO, '1234567890'),
      ).rejects.toThrow(NotFoundException);
      expect(pasarela.consultarPago).not.toHaveBeenCalled();
    });
  });
});
