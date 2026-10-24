import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FijarPreciosDto } from './fijar-precios.dto.js';

const errores = async (datos: object) =>
  (await validate(plainToInstance(FijarPreciosDto, datos)))
    .map((e) => e.property)
    .sort();

const mensajes = async (datos: object) =>
  (await validate(plainToInstance(FijarPreciosDto, datos))).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );

describe('FijarPreciosDto', () => {
  it('E3-H5 · cambio de precio: acepta uno o los dos precios netos con el motivo', async () => {
    expect(
      await errores({ precioMinoristaNeto: 8403.36, motivo: 'Alza' }),
    ).toEqual([]);
    expect(
      await errores({ precioMayoristaNeto: 7000, motivo: 'Alza' }),
    ).toEqual([]);
    expect(
      await errores({
        precioMinoristaNeto: 10000,
        precioMayoristaNeto: 9_999_999_999.99,
        motivo: 'Alza',
      }),
    ).toEqual([]);
  });

  it('E3-H5 · cambio de precio: el motivo es obligatorio y de hasta 500 caracteres', async () => {
    expect(await mensajes({ precioMinoristaNeto: 1000 })).toEqual([
      'El motivo es obligatorio.',
    ]);
    expect(
      await mensajes({ precioMinoristaNeto: 1000, motivo: '   ' }),
    ).toEqual(['El motivo es obligatorio.']);
    expect(
      await mensajes({ precioMinoristaNeto: 1000, motivo: 'a'.repeat(501) }),
    ).toEqual(['El motivo no puede superar los 500 caracteres.']);
  });

  it('E3-H5 · precio guardado en neto: rechaza cero, negativos, más de dos decimales, texto y montos que no caben', async () => {
    for (const precio of [0, -1, 10.123, '1000', 10_000_000_000, null]) {
      expect(
        await errores({ precioMinoristaNeto: precio, motivo: 'Alza' }),
      ).toEqual(['precioMinoristaNeto']);
      expect(
        await errores({ precioMayoristaNeto: precio, motivo: 'Alza' }),
      ).toEqual(['precioMayoristaNeto']);
    }
  });
});
