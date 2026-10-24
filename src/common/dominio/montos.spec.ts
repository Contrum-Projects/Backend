import { calcularMontos, precioConIva } from './montos.js';

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
