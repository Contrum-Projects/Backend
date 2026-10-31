/** Minutos que el cobro cierra antes de que el pedido se cancele por impago (E6-H3). */
export const MARGEN_CIERRE_COBRO_MINUTOS = 2;

/**
 * Hasta cuándo se puede pagar un pedido. El cobro cierra antes de `fechaExpiracionPago` para que un
 * pago de último momento alcance a figurar en Mercado Pago antes de cancelar el pedido (RNF-29).
 */
export const pagarHastaDe = (fechaExpiracionPago: Date): Date =>
  new Date(
    fechaExpiracionPago.getTime() - MARGEN_CIERRE_COBRO_MINUTOS * 60_000,
  );
