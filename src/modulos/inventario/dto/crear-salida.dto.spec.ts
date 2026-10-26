import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mensajesValidacion } from '../../../common/validacion/mensajes-validacion.js';
import { CrearSalidaDto } from './crear-salida.dto.js';

const mensajes = async (datos: object) =>
  mensajesValidacion(await validate(plainToInstance(CrearSalidaDto, datos)));

const salidaBase = () => ({
  formatoId: 11,
  ubicacionId: 1,
  tipo: 'merma_dano',
  cantidad: 2,
});

describe('CrearSalidaDto', () => {
  it('E11-H3 · salida registrada: acepta cada tipo de salida con su cantidad', async () => {
    for (const tipo of [
      'merma_vencimiento',
      'merma_dano',
      'consumo_peluqueria',
    ]) {
      expect(await mensajes({ ...salidaBase(), tipo })).toEqual([]);
    }
    expect(
      await mensajes({ ...salidaBase(), observacion: 'Envase roto' }),
    ).toEqual([]);
  });

  it('E11-H3 · salida registrada: rechaza un tipo que no es salida (también la entrada)', async () => {
    for (const tipo of ['entrada', 'venta', '', undefined]) {
      expect(await mensajes({ ...salidaBase(), tipo })).toEqual([
        'El tipo de salida es obligatorio y debe ser uno de estos: merma_vencimiento, merma_dano, consumo_peluqueria.',
      ]);
    }
  });

  it('E11-H3 · salida registrada: la cantidad es un entero mayor que 0', async () => {
    for (const cantidad of [0, -1, 1.5, '2']) {
      expect(await mensajes({ ...salidaBase(), cantidad })).toEqual([
        'La cantidad debe ser un número entero mayor que 0 y hasta 2147483647.',
      ]);
    }
    expect(await mensajes({ ...salidaBase(), cantidad: undefined })).toEqual([
      'La cantidad es obligatoria.',
    ]);
  });

  it('E11-H3 · salida registrada: exige formato y ubicación', async () => {
    expect(await mensajes({ tipo: 'merma_dano', cantidad: 1 })).toEqual(
      expect.arrayContaining([
        'El formato es obligatorio.',
        'La ubicación es obligatoria.',
      ]),
    );
  });

  it('E11-H3 · salida registrada: la observación es opcional y de hasta 500 caracteres', async () => {
    expect(await mensajes({ ...salidaBase(), observacion: null })).toEqual([]);
    expect(
      await mensajes({ ...salidaBase(), observacion: 'a'.repeat(501) }),
    ).toHaveLength(1);
  });
});
