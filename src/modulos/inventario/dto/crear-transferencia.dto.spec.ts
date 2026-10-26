import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mensajesValidacion } from '../../../common/validacion/mensajes-validacion.js';
import { CrearTransferenciaDto } from './crear-transferencia.dto.js';

const mensajes = async (datos: object) =>
  mensajesValidacion(
    await validate(plainToInstance(CrearTransferenciaDto, datos)),
  );

const transferenciaBase = () => ({
  formatoId: 11,
  ubicacionOrigenId: 1,
  ubicacionDestinoId: 2,
  cantidad: 5,
});

describe('CrearTransferenciaDto', () => {
  it('E11-H4 · transferencia: acepta formato, origen, destino y cantidad, con observación opcional', async () => {
    expect(await mensajes(transferenciaBase())).toEqual([]);
    expect(
      await mensajes({ ...transferenciaBase(), observacion: 'Reposición' }),
    ).toEqual([]);
    expect(
      await mensajes({ ...transferenciaBase(), observacion: null }),
    ).toEqual([]);
  });

  it('E11-H4 · transferencia: la cantidad es un entero mayor que 0', async () => {
    for (const cantidad of [0, -1, 1.5, '2']) {
      expect(await mensajes({ ...transferenciaBase(), cantidad })).toEqual([
        'La cantidad debe ser un número entero mayor que 0 y hasta 2147483647.',
      ]);
    }
  });

  it('E11-H4 · transferencia: exige formato, origen y destino', async () => {
    expect(await mensajes({ cantidad: 1 })).toEqual(
      expect.arrayContaining([
        'El formato es obligatorio.',
        'La ubicación de origen es obligatoria.',
        'La ubicación de destino es obligatoria.',
      ]),
    );
  });

  it('E11-H4 · transferencia: la observación no pasa de 500 caracteres', async () => {
    expect(
      await mensajes({ ...transferenciaBase(), observacion: 'a'.repeat(501) }),
    ).toEqual(['La observación no puede superar los 500 caracteres.']);
  });
});
