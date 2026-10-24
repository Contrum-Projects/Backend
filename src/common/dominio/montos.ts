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
