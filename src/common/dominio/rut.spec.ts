import { normalizarRut } from './rut.js';

describe('normalizarRut', () => {
  it('acepta puntos y guion y devuelve el formato único', () => {
    expect(normalizarRut('12.345.678-5')).toBe('12345678-5');
    expect(normalizarRut('123456785')).toBe('12345678-5');
  });

  it('acepta el dígito verificador K en minúscula', () => {
    expect(normalizarRut('10.000.013-k')).toBe('10000013-K');
  });

  it('acepta el dígito verificador 0', () => {
    expect(normalizarRut('7.000.004-0')).toBe('7000004-0');
  });

  it('rechaza un dígito verificador incorrecto', () => {
    expect(normalizarRut('12.345.678-9')).toBeNull();
  });

  it('rechaza formatos que no son RUT', () => {
    expect(normalizarRut('')).toBeNull();
    expect(normalizarRut('abc')).toBeNull();
    expect(normalizarRut('123-4')).toBeNull();
  });
});
