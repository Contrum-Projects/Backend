/**
 * Reglas de montos (RNF-11): se guardan netos y el IVA aparte; los totales del
 * pedido se cierran al crearlo. Los montos del pedido son enteros en pesos (CLP).
 */
export interface Montos {
  neto: number;
  iva: number;
  total: number;
}

/**
 * Calcula IVA y total a partir de un neto en pesos.
 * El IVA se redondea al peso más cercano, así que total === neto + iva siempre.
 */
export function calcularMontos(neto: number, porcentajeIva: number): Montos {
  if (!Number.isInteger(neto) || neto < 0) {
    throw new RangeError(
      'El neto debe ser un entero en pesos, mayor o igual a 0',
    );
  }
  const iva = Math.round((neto * porcentajeIva) / 100);
  return { neto, iva, total: neto + iva };
}

/**
 * Precio unitario con IVA que ve y paga el comprador, en pesos enteros. El precio neto guardado
 * puede tener centavos (`Decimal(12, 2)`): se redondea al peso y luego se le suma el IVA con
 * `calcularMontos`. La tienda (E2) y el pedido (E5) usan esta misma función, así el precio que
 * se muestra es el que se cobra.
 */
export const precioConIva = (
  netoGuardado: number,
  porcentajeIva: number,
): number => calcularMontos(Math.round(netoGuardado), porcentajeIva).total;

/**
 * Neto en pesos de un monto que ya trae el IVA (E7-H2, decisión del 31 de octubre de 2026: la tarifa
 * del courier). Por el redondeo, `precioConIva` del resultado puede diferir en un peso del monto.
 */
export const netoDesdeConIva = (
  conIva: number,
  porcentajeIva: number,
): number => Math.round(conIva / (1 + porcentajeIva / 100));

/**
 * Montos del pedido, sumados por línea (decisión del 30 de octubre de 2026, E5-H3): el total es la
 * suma de `precioConIva` × cantidad, el mismo que muestran el carrito y el detalle del pedido. Por
 * eso el IVA puede diferir unos pesos de aplicar la tasa al neto total; total === neto + iva.
 */
export const montosPorLineas = (
  lineas: { netoGuardado: number; cantidad: number }[],
  porcentajeIva: number,
): Montos => {
  let neto = 0;
  let total = 0;
  for (const { netoGuardado, cantidad } of lineas) {
    neto += Math.round(netoGuardado) * cantidad;
    total += precioConIva(netoGuardado, porcentajeIva) * cantidad;
  }
  return { neto, iva: total - neto, total };
};
