import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TextoObligatorio } from './texto-obligatorio.js';

class Obligatorio {
  @TextoObligatorio({ etiqueta: 'El nombre', maximo: 5 })
  nombre: unknown;
}

class Femenino {
  @TextoObligatorio({ etiqueta: 'La nota', maximo: 5, femenino: true })
  nota: unknown;
}

class PuedeFaltar {
  @TextoObligatorio({ etiqueta: 'El nombre', maximo: 5, puedeFaltar: true })
  nombre?: unknown;
}

const mensajes = <T extends object>(clase: new () => T, datos: object) =>
  validateSync(plainToInstance(clase, datos)).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );

describe('TextoObligatorio', () => {
  it('acepta un texto y lo recorta antes de validar el largo', () => {
    const objeto = plainToInstance(Obligatorio, { nombre: '  Hola  ' });

    expect(validateSync(objeto)).toHaveLength(0);
    expect(objeto.nombre).toBe('Hola');
  });

  it('un dato que falta, vacío, en blanco o de otro tipo da un solo mensaje que lo nombra', () => {
    for (const nombre of [undefined, null, '', '   ', 12]) {
      expect(mensajes(Obligatorio, { nombre })).toEqual([
        'El nombre es obligatorio.',
      ]);
    }
  });

  it('con etiqueta femenina el mensaje concuerda', () => {
    expect(mensajes(Femenino, {})).toEqual(['La nota es obligatoria.']);
  });

  it('un texto demasiado largo dice el máximo', () => {
    expect(mensajes(Obligatorio, { nombre: 'abcdef' })).toEqual([
      'El nombre no puede superar los 5 caracteres.',
    ]);
  });

  it('con puedeFaltar, la ausencia es válida pero null o vacío no', () => {
    expect(mensajes(PuedeFaltar, {})).toEqual([]);
    expect(mensajes(PuedeFaltar, { nombre: null })).toEqual([
      'El nombre es obligatorio.',
    ]);
    expect(mensajes(PuedeFaltar, { nombre: '  ' })).toEqual([
      'El nombre es obligatorio.',
    ]);
  });
});
