import type { Bulto } from './cotizador-envio.js';

/** Un formato del carrito con sus medidas, las veces que va. */
export interface UnidadesBulto extends Bulto {
  cantidad: number;
}

/**
 * Un solo bulto para todo el carrito (E7-H2, decisión del 31 de octubre de 2026): una unidad va con
 * sus medidas reales; varias, con el peso total y un cubo con el volumen total, redondeando el lado
 * hacia arriba al centímetro. `null` si no hay unidades.
 */
export const armarBulto = (lineas: UnidadesBulto[]): Bulto | null => {
  const unidades = lineas.reduce((suma, l) => suma + l.cantidad, 0);
  if (unidades === 0) return null;
  if (unidades === 1) {
    const { pesoGramos, altoCm, anchoCm, largoCm } = lineas.find(
      (l) => l.cantidad === 1,
    )!;
    return { pesoGramos, altoCm, anchoCm, largoCm };
  }
  let pesoGramos = 0;
  let volumen = 0;
  for (const {
    cantidad,
    pesoGramos: peso,
    altoCm,
    anchoCm,
    largoCm,
  } of lineas) {
    pesoGramos += peso * cantidad;
    volumen += altoCm * anchoCm * largoCm * cantidad;
  }
  const lado = Math.ceil(Math.cbrt(volumen));
  return { pesoGramos, altoCm: lado, anchoCm: lado, largoCm: lado };
};
