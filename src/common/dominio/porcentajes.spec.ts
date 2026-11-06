import { porcentaje } from './porcentajes.js';

describe('porcentaje', () => {
  it.each([
    [41, 100, 41],
    [1, 3, 33],
    [2, 3, 67],
    [0, 5, 0],
    [5, 5, 100],
  ])(
    'SCRUM-150 · %i de %i es %i %%, redondeado al entero',
    (parte, total, esperado) => {
      expect(porcentaje(parte, total)).toBe(esperado);
    },
  );

  it('SCRUM-150 · sin base (total 0) no hay porcentaje: null', () => {
    expect(porcentaje(0, 0)).toBeNull();
  });
});
