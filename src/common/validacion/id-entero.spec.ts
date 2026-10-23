import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IdEntero } from './id-entero.js';

const textos = { faltante: 'Falta el id.', invalido: 'El id no es válido.' };

class Obligatorio {
  @IdEntero(textos)
  id: unknown;
}

class Opcional {
  @IdEntero({ ...textos, opcional: true })
  id?: unknown;
}

const mensajes = <T extends object>(clase: new () => T, datos: object) =>
  validateSync(plainToInstance(clase, datos)).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );

describe('IdEntero', () => {
  it('acepta enteros positivos hasta el máximo de la columna', () => {
    for (const id of [1, 42, 2_147_483_647]) {
      expect(mensajes(Obligatorio, { id })).toEqual([]);
    }
  });

  it('un id que falta da el mensaje de «falta»', () => {
    expect(mensajes(Obligatorio, {})).toEqual(['Falta el id.']);
    expect(mensajes(Obligatorio, { id: null })).toEqual(['Falta el id.']);
  });

  it('un valor que no es un id posible da un solo mensaje de «no válido»', () => {
    for (const id of [0, -1, 1.5, '3', 2_147_483_648, NaN]) {
      expect(mensajes(Obligatorio, { id })).toEqual(['El id no es válido.']);
    }
  });

  it('opcional: puede faltar, pero null o un valor malo no pasan', () => {
    expect(mensajes(Opcional, {})).toEqual([]);
    expect(mensajes(Opcional, { id: 3 })).toEqual([]);
    expect(mensajes(Opcional, { id: null })).toEqual(['Falta el id.']);
    expect(mensajes(Opcional, { id: 0 })).toEqual(['El id no es válido.']);
  });
});
