import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mensajesValidacion } from '../../../common/validacion/mensajes-validacion.js';
import { MAXIMO_UNIDADES_LINEA } from './articulo-carrito.dto.js';
import {
  ArticulosNavegadorDto,
  MAXIMO_ARTICULOS_NAVEGADOR,
} from './articulos-navegador.dto.js';

const probar = async (entrada: object) =>
  mensajesValidacion(
    await validate(plainToInstance(ArticulosNavegadorDto, entrada), {
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

const lista = (largo: number) =>
  Array.from({ length: largo }, (_, i) => ({ articuloId: i + 1, cantidad: 1 }));

describe('ArticulosNavegadorDto', () => {
  it(`acepta de 1 a ${MAXIMO_ARTICULOS_NAVEGADOR} artículos distintos con cantidades de 1 a ${MAXIMO_UNIDADES_LINEA}`, async () => {
    expect(await probar({ articulos: lista(1) })).toEqual([]);
    expect(
      await probar({ articulos: lista(MAXIMO_ARTICULOS_NAVEGADOR) }),
    ).toEqual([]);
    expect(
      await probar({
        articulos: [{ articuloId: 1, cantidad: MAXIMO_UNIDADES_LINEA }],
      }),
    ).toEqual([]);
  });

  it('exige una lista con artículos', async () => {
    for (const entrada of [{}, { articulos: [] }, { articulos: 'abc' }]) {
      expect(await probar(entrada)).toEqual([
        'Indica los artículos del carrito.',
      ]);
    }
  });

  it(`rechaza más de ${MAXIMO_ARTICULOS_NAVEGADOR} artículos y los repetidos`, async () => {
    expect(
      await probar({ articulos: lista(MAXIMO_ARTICULOS_NAVEGADOR + 1) }),
    ).toEqual([
      `El carrito tiene hasta ${MAXIMO_ARTICULOS_NAVEGADOR} artículos distintos.`,
    ]);
    expect(
      await probar({
        articulos: [
          { articuloId: 1, cantidad: 1 },
          { articuloId: 1, cantidad: 2 },
        ],
      }),
    ).toEqual([
      'Cada artículo debe aparecer una sola vez: indica su cantidad.',
    ]);
  });

  it('rechaza ids y cantidades inválidos y campos de más', async () => {
    expect(
      await probar({ articulos: [{ articuloId: 'abc', cantidad: 0 }] }),
    ).toEqual(
      expect.arrayContaining([
        'Algún artículo indicado no es válido.',
        `La cantidad de cada artículo debe ser un número entero mayor que 0 y hasta ${MAXIMO_UNIDADES_LINEA}.`,
      ]),
    );
    expect(
      await probar({
        articulos: [{ articuloId: 1, cantidad: MAXIMO_UNIDADES_LINEA + 1 }],
      }),
    ).toHaveLength(1);
    expect(
      await probar({
        articulos: [{ articuloId: 1, cantidad: 1, precio: 100 }],
      }),
    ).toHaveLength(1);
  });
});
