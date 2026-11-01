import {
  calcularMontos,
  montosPorLineas,
  netoDesdeConIva,
  precioConIva,
} from './montos.js';

describe('netoDesdeConIva', () => {
  it('E7-H2 · cotización obtenida: divide la tarifa por el IVA, y al sumarlo vuelve a la tarifa', () => {
    expect(netoDesdeConIva(7310, 19)).toBe(6143);
    expect(precioConIva(6143, 19)).toBe(7310);
  });
});

describe('montosPorLineas', () => {
  it('E5-H3 · pedido creado: el total es la suma de precioConIva × cantidad, igual que el carrito', () => {
    expect(montosPorLineas([{ netoGuardado: 1003, cantidad: 3 }], 19)).toEqual({
      neto: 3009,
      iva: 573,
      total: 3582,
    });
  });

  it('redondea el neto con centavos antes de sumar y total === neto + iva', () => {
    const montos = montosPorLineas(
      [
        { netoGuardado: 1000.4, cantidad: 2 },
        { netoGuardado: 0, cantidad: 1 },
      ],
      19,
    );
    expect(montos).toEqual({ neto: 2000, iva: 380, total: 2380 });
    expect(montos.total).toBe(montos.neto + montos.iva);
  });
});

describe('precioConIva', () => {
  it('E3-H5 · precio guardado en neto: redondea el neto al peso y le suma el IVA', () => {
    expect(precioConIva(8_403.36, 19)).toBe(10_000);
    expect(precioConIva(10_000, 19)).toBe(11_900);
    // 999,5 se redondea a 1.000 antes del IVA
    expect(precioConIva(999.5, 19)).toBe(1_190);
  });
});

describe('calcularMontos', () => {
  it('suma neto e IVA en el total (RNF-11)', () => {
    expect(calcularMontos(10_000, 19)).toEqual({
      neto: 10_000,
      iva: 1_900,
      total: 11_900,
    });
  });

  it('redondea el IVA al peso y mantiene total = neto + iva', () => {
    const m = calcularMontos(9_999, 19);
    expect(m.iva).toBe(1_900);
    expect(m.total).toBe(m.neto + m.iva);
  });

  it('rechaza netos con decimales o negativos', () => {
    expect(() => calcularMontos(10.5, 19)).toThrow(RangeError);
    expect(() => calcularMontos(-1, 19)).toThrow(RangeError);
  });
});
