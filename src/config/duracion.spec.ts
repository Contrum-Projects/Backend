import { duracionAMs } from './duracion.js';

describe('duracionAMs', () => {
  it('convierte segundos, minutos, horas y días', () => {
    expect(duracionAMs('45s')).toBe(45_000);
    expect(duracionAMs('15m')).toBe(900_000);
    expect(duracionAMs('2h')).toBe(7_200_000);
    expect(duracionAMs('30d')).toBe(2_592_000_000);
  });

  it('rechaza formatos que no entiende', () => {
    expect(() => duracionAMs('15')).toThrow(/Duración inválida/);
    expect(() => duracionAMs('1 d')).toThrow();
    expect(() => duracionAMs('1w')).toThrow();
  });
});
