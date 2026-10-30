import type { ESTADOS_PAGO, Valor } from '../../common/dominio/valores.js';

/** Lo que se cobra: el pedido entero, por su total con IVA en pesos (E6-H1). */
export interface CobroPedido {
  codigoPedido: string;
  montoTotal: number;
  /** Después de esta hora Mercado Pago ya no deja pagar (el plazo de E5). */
  pagarHasta: Date;
  /** Adonde vuelve el comprador al terminar, apruebe o no. */
  urlRegreso: string;
}

/** Un pago tal como lo informa la pasarela, sin datos de la tarjeta (RNF-05). */
export interface PagoPasarela {
  idExterno: string;
  estado: Valor<typeof ESTADOS_PAGO>;
  monto: number;
  moneda: string;
  /** Código del pedido que se le dio al cobrarlo; `null` si el pago no viene de esta tienda. */
  codigoPedido: string | null;
  /** Medio con que se pagó (`visa`, `debvisa`, `account_money`...), nunca el número. */
  medioPago: string | null;
  fechaAprobacion: Date | null;
}

/**
 * Pasarela de pago (Mercado Pago, Checkout Pro). El servicio de negocio solo conoce esta
 * interfaz: en producción es el SDK de Mercado Pago y en las pruebas un doble.
 */
export abstract class PasarelaPago {
  /** Prepara el cobro y devuelve la URL donde paga el comprador. 503 si no responde. */
  abstract crearCobro(cobro: CobroPedido): Promise<string>;

  /** Consulta un pago por su id; `null` si no existe. 503 si no responde. */
  abstract consultarPago(idExterno: string): Promise<PagoPasarela | null>;
}
