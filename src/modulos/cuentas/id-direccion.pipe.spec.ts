import { NotFoundException } from '@nestjs/common';
import { IdDireccionPipe } from './id-direccion.pipe.js';

describe('IdDireccionPipe', () => {
  const pipe = new IdDireccionPipe();

  it('convierte un id válido en número', () => {
    expect(pipe.transform('15')).toBe(15);
    expect(pipe.transform('2147483647')).toBe(2_147_483_647);
  });

  it('responde 404 a un id que no es un entero positivo de int4', () => {
    for (const valor of [
      'abc',
      '0',
      '-1',
      '1.5',
      '2147483648',
      '99999999999',
    ]) {
      expect(() => pipe.transform(valor)).toThrow(NotFoundException);
    }
  });
});
