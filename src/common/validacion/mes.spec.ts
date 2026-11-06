import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Mes } from './mes.js';

class Periodo {
  @Mes({ etiqueta: 'El mes desde', presencia: 'obligatorio' })
  desde: unknown;
}

const mensajes = (datos: object) =>
  validateSync(plainToInstance(Periodo, datos)).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );

describe('Mes', () => {
  it('acepta un mes AAAA-MM y lo recorta', () => {
    const objeto = plainToInstance(Periodo, { desde: ' 2026-11 ' });

    expect(validateSync(objeto)).toHaveLength(0);
    expect(objeto.desde).toBe('2026-11');
  });

  it('rechaza meses fuera de 01-12, sin cero inicial, el año 0 o que no son texto', () => {
    for (const desde of ['2026-13', '2026-00', '2026-1', '0000-01', 202611]) {
      expect(mensajes({ desde })).toEqual([
        'El mes desde debe ser un mes válido con el formato AAAA-MM.',
      ]);
    }
  });

  it('obligatorio: si falta lo dice', () => {
    expect(mensajes({})).toEqual(['El mes desde es obligatorio.']);
  });
});
