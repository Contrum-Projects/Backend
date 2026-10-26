import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mensajesValidacion } from '../../../common/validacion/mensajes-validacion.js';
import { CrearAjusteDto } from './crear-ajuste.dto.js';

const mensajes = async (datos: object) =>
  mensajesValidacion(await validate(plainToInstance(CrearAjusteDto, datos)));

const ajusteBase = () => ({
  formatoId: 11,
  ubicacionId: 1,
  cantidad: -2,
  observacion: 'Conteo físico: faltan 2',
});

describe('CrearAjusteDto', () => {
  it('E11-H4 · ajuste de stock: acepta una cantidad positiva o negativa', async () => {
    for (const cantidad of [3, -2, 2_147_483_647, -2_147_483_647]) {
      expect(await mensajes({ ...ajusteBase(), cantidad })).toEqual([]);
    }
  });

  it('E11-H4 · ajuste de stock: la cantidad es un entero distinto de 0', async () => {
    for (const cantidad of [0, 1.5, '2', 2_147_483_648, -2_147_483_648]) {
      expect(await mensajes({ ...ajusteBase(), cantidad })).toEqual([
        'La cantidad debe ser un número entero distinto de 0, entre -2147483647 y 2147483647.',
      ]);
    }
    expect(await mensajes({ ...ajusteBase(), cantidad: undefined })).toEqual([
      'La cantidad es obligatoria.',
    ]);
  });

  it('E11-H4 · ajuste de stock: el motivo es obligatorio y de hasta 500 caracteres', async () => {
    for (const observacion of [undefined, null, '', '   ']) {
      expect(await mensajes({ ...ajusteBase(), observacion })).toEqual([
        'El motivo del ajuste es obligatorio.',
      ]);
    }
    expect(
      await mensajes({ ...ajusteBase(), observacion: 'a'.repeat(501) }),
    ).toEqual(['El motivo del ajuste no puede superar los 500 caracteres.']);
  });

  it('E11-H4 · ajuste de stock: exige formato y ubicación', async () => {
    expect(
      await mensajes({ cantidad: 1, observacion: 'Conteo físico' }),
    ).toEqual(
      expect.arrayContaining([
        'El formato es obligatorio.',
        'La ubicación es obligatoria.',
      ]),
    );
  });
});
