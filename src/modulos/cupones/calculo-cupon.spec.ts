import { describe, expect, it } from 'vitest';
import {
  calcularDescuento,
  type LineaCupon,
  type ReglasCupon,
} from './calculo-cupon.js';

const reglas = (cambios: Partial<ReglasCupon> = {}): ReglasCupon => ({
  tipoDescuento: 'porcentaje',
  valor: 20,
  topeDescuento: null,
  alcance: 'pedido',
  compraMinima: null,
  articulos: [],
  categorias: [],
  marcas: [],
  ...cambios,
});

/** Shampoo de la marca 7 (categoría 3) y un pack con un componente de otra marca. */
const SHAMPOO: LineaCupon = {
  articuloId: 1,
  cantidad: 2,
  precioConIva: 10000,
  productos: [{ categoriaId: 3, marcaId: 7 }],
};
const PACK: LineaCupon = {
  articuloId: 50,
  cantidad: 1,
  precioConIva: 30000,
  productos: [
    { categoriaId: 3, marcaId: 7 },
    { categoriaId: 4, marcaId: 8 },
  ],
};

describe('Cálculo del cupón (SCRUM-150)', () => {
  it('SCRUM-150 · porcentaje sobre todo el pedido, redondeado al peso', () => {
    expect(calcularDescuento(reglas({ valor: 15 }), [SHAMPOO, PACK])).toEqual({
      aplica: true,
      descuento: 7500,
      base: 50000,
    });
  });

  it('SCRUM-150 · el porcentaje respeta su tope en pesos', () => {
    expect(
      calcularDescuento(reglas({ topeDescuento: 3000 }), [SHAMPOO, PACK]),
    ).toMatchObject({ descuento: 3000 });
  });

  it('SCRUM-150 · monto fijo, sin pasar de lo que cubre', () => {
    expect(
      calcularDescuento(
        reglas({
          tipoDescuento: 'monto_fijo',
          valor: 50000,
          alcance: 'articulos',
          articulos: [1],
        }),
        [SHAMPOO, PACK],
      ),
    ).toMatchObject({ descuento: 20000, base: 20000 });
  });

  it('SCRUM-150 · por formato o pack: solo las líneas elegidas', () => {
    expect(
      calcularDescuento(reglas({ alcance: 'articulos', articulos: [50] }), [
        SHAMPOO,
        PACK,
      ]),
    ).toMatchObject({ descuento: 6000, base: 30000 });
  });

  it('SCRUM-150 · por marca: un pack entra solo si todos sus componentes calzan', () => {
    const porMarca = reglas({ alcance: 'categorias_marcas', marcas: [7] });
    expect(calcularDescuento(porMarca, [SHAMPOO, PACK])).toMatchObject({
      base: 20000,
    });
    expect(
      calcularDescuento({ ...porMarca, marcas: [7, 8] }, [SHAMPOO, PACK]),
    ).toMatchObject({ base: 50000 });
    // Categoría o marca: el componente de la categoría 4 calza por categoría
    expect(
      calcularDescuento({ ...porMarca, categorias: [4] }, [PACK]),
    ).toMatchObject({ base: 30000 });
  });

  it('SCRUM-150 · compra mínima con el subtotal de todos los productos', () => {
    expect(
      calcularDescuento(reglas({ compraMinima: 60000 }), [SHAMPOO, PACK]),
    ).toEqual({ aplica: false, motivo: 'compra_minima' });
    expect(
      calcularDescuento(reglas({ compraMinima: 50000 }), [SHAMPOO, PACK]),
    ).toMatchObject({ aplica: true });
  });

  it('SCRUM-150 · sin productos cubiertos no aplica', () => {
    expect(
      calcularDescuento(reglas({ alcance: 'articulos', articulos: [99] }), [
        SHAMPOO,
      ]),
    ).toEqual({ aplica: false, motivo: 'sin_productos' });
  });

  it('SCRUM-150 · el pedido siempre cobra al menos $1 de productos', () => {
    expect(calcularDescuento(reglas({ valor: 100 }), [SHAMPOO])).toMatchObject({
      descuento: 19999,
    });
  });
});
