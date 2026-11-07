import {
  ALCANCES_CUPON,
  TIPOS_DESCUENTO_CUPON,
} from '../../common/dominio/valores.js';

/** Lo que el cálculo necesita de un cupón. */
export interface ReglasCupon {
  tipoDescuento: string;
  valor: number;
  topeDescuento: number | null;
  alcance: string;
  compraMinima: number | null;
  /** Ids de los formatos o packs elegidos (alcance `articulos`). */
  articulos: number[];
  /** Categorías elegidas, ya con sus subcategorías (alcance `categorias_marcas`). */
  categorias: number[];
  marcas: number[];
}

/** Una línea del carrito o del pedido, con el precio con IVA que paga el rol. */
export interface LineaCupon {
  articuloId: number;
  cantidad: number;
  precioConIva: number;
  /** El producto de cada formato que lo compone: él mismo si es formato, sus componentes si es pack. */
  productos: { categoriaId: number; marcaId: number | null }[];
}

export type ResultadoCupon =
  | { aplica: true; descuento: number; base: number }
  | { aplica: false; motivo: 'compra_minima' | 'sin_productos' };

/**
 * Si la línea entra en el cupón (SCRUM-150). Por categoría o marca, cada producto debe ser de una
 * de las categorías o de una de las marcas; un pack entra solo si todos sus componentes calzan
 * (decisión del 7 nov).
 */
export const lineaCubierta = (
  reglas: ReglasCupon,
  linea: LineaCupon,
): boolean => {
  switch (reglas.alcance) {
    case ALCANCES_CUPON.PEDIDO:
      return true;
    case ALCANCES_CUPON.ARTICULOS:
      return reglas.articulos.includes(linea.articuloId);
    case ALCANCES_CUPON.CATEGORIAS_MARCAS:
      return (
        linea.productos.length > 0 &&
        linea.productos.every(
          ({ categoriaId, marcaId }) =>
            reglas.categorias.includes(categoriaId) ||
            (marcaId !== null && reglas.marcas.includes(marcaId)),
        )
      );
    default:
      return false;
  }
};

/**
 * Cuánto descuenta el cupón, en pesos con IVA (SCRUM-150). La compra mínima se mide con el
 * subtotal de todos los productos (sin despacho); el descuento, solo sobre las líneas que cubre:
 * un porcentaje redondeado al peso con su tope, o un monto fijo que nunca pasa de esas líneas.
 * PROPUESTA por confirmar: el pedido siempre cobra al menos $1 de productos, porque Mercado Pago
 * no acepta un cobro de $0.
 */
export const calcularDescuento = (
  reglas: ReglasCupon,
  lineas: LineaCupon[],
): ResultadoCupon => {
  const subtotal = lineas.reduce(
    (suma, linea) => suma + linea.precioConIva * linea.cantidad,
    0,
  );
  if (reglas.compraMinima !== null && subtotal < reglas.compraMinima) {
    return { aplica: false, motivo: 'compra_minima' };
  }
  const base = lineas
    .filter((linea) => lineaCubierta(reglas, linea))
    .reduce((suma, linea) => suma + linea.precioConIva * linea.cantidad, 0);
  if (base === 0) return { aplica: false, motivo: 'sin_productos' };

  const bruto =
    reglas.tipoDescuento === TIPOS_DESCUENTO_CUPON.PORCENTAJE
      ? Math.round((base * reglas.valor) / 100)
      : reglas.valor;
  const conTope =
    reglas.topeDescuento !== null
      ? Math.min(bruto, reglas.topeDescuento)
      : bruto;
  const descuento = Math.min(conTope, base, subtotal - 1);
  return { aplica: true, descuento: Math.max(descuento, 0), base };
};
