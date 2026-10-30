import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  MercadoPagoConfig,
  MPBadRequestError,
  MPNotFoundError,
  Payment,
  Preference,
} from 'mercadopago';
import { ESTADOS_PAGO, type Valor } from '../../common/dominio/valores.js';
import {
  type CobroPedido,
  type PagoPasarela,
  PasarelaPago,
} from './pasarela-pago.js';

export const PASARELA_NO_RESPONDE =
  'No pudimos conectar con Mercado Pago. Intenta de nuevo en unos minutos.';
export const PASARELA_NO_CONFIGURADA =
  'El pago con Mercado Pago no está configurado.';

/** Si Mercado Pago no responde en este plazo, la petición falla con 503. */
const PLAZO_RESPUESTA_MS = 10_000;
const MONEDA = 'CLP';

/**
 * Estado de Mercado Pago → estado del pago. Solo `approved` aprueba: un estado desconocido nunca
 * deja un pedido pagado.
 */
const estadoDePago = (
  status: string | undefined,
): Valor<typeof ESTADOS_PAGO> => {
  if (status === 'approved') return ESTADOS_PAGO.APROBADO;
  if (status === 'rejected' || status === 'cancelled') {
    return ESTADOS_PAGO.RECHAZADO;
  }
  return ESTADOS_PAGO.PENDIENTE;
};

/** Mercado Pago con Checkout Pro: el comprador paga en su sitio y vuelve a la tienda. */
export class PasarelaMercadoPago extends PasarelaPago {
  private readonly logger = new Logger('MercadoPago');
  private readonly preferencias: Preference;
  private readonly pagos: Payment;

  constructor(tokenAcceso: string) {
    super();
    const config = new MercadoPagoConfig({
      accessToken: tokenAcceso,
      options: { timeout: PLAZO_RESPUESTA_MS },
    });
    this.preferencias = new Preference(config);
    this.pagos = new Payment(config);
  }

  async crearCobro(cobro: CobroPedido): Promise<string> {
    try {
      const preferencia = await this.preferencias.create({
        body: {
          items: [
            {
              id: cobro.codigoPedido,
              title: `Pedido ${cobro.codigoPedido} · Cabello Perfecto`,
              quantity: 1,
              unit_price: cobro.montoTotal,
              currency_id: MONEDA,
            },
          ],
          external_reference: cobro.codigoPedido,
          // Sin pagos «en proceso»: se aprueba o se rechaza dentro del plazo de 15 minutos
          binary_mode: true,
          expires: true,
          expiration_date_to: cobro.pagarHasta.toISOString(),
          back_urls: {
            success: cobro.urlRegreso,
            failure: cobro.urlRegreso,
            pending: cobro.urlRegreso,
          },
          // El regreso automático exige una URL https (en desarrollo, el comprador pulsa «Volver»)
          auto_return: cobro.urlRegreso.startsWith('https://')
            ? 'approved'
            : undefined,
        },
      });
      if (!preferencia.init_point) {
        throw new Error('Mercado Pago no devolvió la URL de pago.');
      }
      return preferencia.init_point;
    } catch (error) {
      this.registrarFalla('crear el cobro', error);
      throw new ServiceUnavailableException(PASARELA_NO_RESPONDE);
    }
  }

  async consultarPago(idExterno: string): Promise<PagoPasarela | null> {
    try {
      const pago = await this.pagos.get({ id: idExterno });
      return {
        idExterno: String(pago.id ?? idExterno),
        estado: estadoDePago(pago.status),
        monto: pago.transaction_amount ?? 0,
        moneda: pago.currency_id ?? '',
        codigoPedido: pago.external_reference || null,
        medioPago: pago.payment_method_id ?? null,
        fechaAprobacion: pago.date_approved
          ? new Date(pago.date_approved)
          : null,
      };
    } catch (error) {
      if (error instanceof MPNotFoundError) return null;
      if (error instanceof MPBadRequestError) {
        // El DTO ya filtra el formato: un 400 puede ser una credencial mal configurada
        this.registrarFalla('consultar el pago', error);
        return null;
      }
      this.registrarFalla('consultar el pago', error);
      throw new ServiceUnavailableException(PASARELA_NO_RESPONDE);
    }
  }

  // Solo el tipo y el estado HTTP: la respuesta puede traer datos del comprador
  private registrarFalla(accion: string, error: unknown) {
    const detalle =
      error instanceof Error
        ? `${error.name}${'status' in error ? ` (${String(error.status)})` : ''}`
        : 'error desconocido';
    this.logger.error(`No se pudo ${accion} en Mercado Pago: ${detalle}`);
  }
}

/** Sin `MERCADOPAGO_ACCESS_TOKEN`: la app arranca, pero pagar responde 503. */
export class PasarelaNoConfigurada extends PasarelaPago {
  crearCobro(): Promise<string> {
    return Promise.reject(
      new ServiceUnavailableException(PASARELA_NO_CONFIGURADA),
    );
  }

  consultarPago(): Promise<PagoPasarela | null> {
    return Promise.reject(
      new ServiceUnavailableException(PASARELA_NO_CONFIGURADA),
    );
  }
}
