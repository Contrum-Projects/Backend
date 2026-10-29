import { NotFoundException } from '@nestjs/common';
import { CodigoPedidoPipe } from './codigo-pedido.pipe.js';

describe('CodigoPedidoPipe', () => {
  const pipe = new CodigoPedidoPipe();

  it('deja pasar un código de 12 caracteres alfanuméricos', () => {
    expect(pipe.transform('AB12CD34EF56')).toBe('AB12CD34EF56');
    expect(pipe.transform('abcdefghijkl')).toBe('abcdefghijkl');
  });

  it('cualquier otro valor responde 404 «El pedido no existe.»', () => {
    for (const valor of [
      '',
      'corto',
      'AB12CD34EF567',
      'AB12-CD34EF5',
      "AB12CD34EF5'",
      ' AB12CD34EF5',
    ]) {
      expect(() => pipe.transform(valor)).toThrow(
        new NotFoundException('El pedido no existe.'),
      );
    }
  });
});
