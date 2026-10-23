import { NotFoundException } from '@nestjs/common';
import { IdProductoPipe } from './id-producto.pipe.js';

describe('IdProductoPipe', () => {
  const pipe = new IdProductoPipe();

  it('devuelve el id cuando es un entero positivo de la columna', () => {
    expect(pipe.transform('7')).toBe(7);
    expect(pipe.transform('2147483647')).toBe(2_147_483_647);
  });

  it('un id que no es un entero positivo o no cabe en la columna responde 404', () => {
    for (const valor of [
      '0',
      '-3',
      '1.5',
      'abc',
      '',
      '2147483648',
      '99999999999',
    ]) {
      expect(() => pipe.transform(valor)).toThrow(NotFoundException);
    }
  });
});
