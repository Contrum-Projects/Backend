import { subtotalNeto, totalesEntrada } from './totales-entrada.js';

describe('totalesEntrada', () => {
  it('E11-H2 · suma unidades y costo neto sin errores de coma flotante en los centavos', () => {
    // 0,1 × 3 en coma flotante da 0,30000000000000004
    expect(subtotalNeto(3, 0.1).toNumber()).toBe(0.3);
    expect(
      totalesEntrada([
        { cantidad: 24, costoUnitarioNeto: 3500 },
        { cantidad: 6, costoUnitarioNeto: 1990.5 },
        { cantidad: 3, costoUnitarioNeto: 0.1 },
      ]),
    ).toEqual({ unidades: 33, costoNetoTotal: 95943.3 });
  });

  it('una entrada sin líneas suma cero', () => {
    expect(totalesEntrada([])).toEqual({ unidades: 0, costoNetoTotal: 0 });
  });
});
