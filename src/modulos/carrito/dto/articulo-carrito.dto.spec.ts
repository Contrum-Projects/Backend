import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mensajesValidacion } from '../../../common/validacion/mensajes-validacion.js';
import {
  AgregarArticuloCarritoDto,
  CambiarCantidadCarritoDto,
  MAXIMO_UNIDADES_LINEA,
} from './articulo-carrito.dto.js';

const probar = async <T extends object>(clase: new () => T, entrada: object) =>
  mensajesValidacion(
    await validate(plainToInstance(clase, entrada), {
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

describe('AgregarArticuloCarritoDto', () => {
  it('acepta un artículo y una cantidad entera de 1 hasta el máximo', async () => {
    for (const cantidad of [1, 2, MAXIMO_UNIDADES_LINEA]) {
      expect(
        await probar(AgregarArticuloCarritoDto, { articuloId: 11, cantidad }),
      ).toEqual([]);
    }
  });

  it('exige el artículo y la cantidad, cada uno con su mensaje', async () => {
    expect(await probar(AgregarArticuloCarritoDto, {})).toEqual(
      expect.arrayContaining([
        'Indica el artículo que quieres agregar.',
        'La cantidad es obligatoria.',
      ]),
    );
  });

  it('rechaza ids inválidos y cantidades en cero, negativas, con decimales, en texto o sobre el máximo', async () => {
    expect(
      await probar(AgregarArticuloCarritoDto, {
        articuloId: 'abc',
        cantidad: 1,
      }),
    ).toEqual(['El artículo indicado no es válido.']);
    for (const cantidad of [0, -2, 1.5, '3', MAXIMO_UNIDADES_LINEA + 1]) {
      const mensajes = await probar(AgregarArticuloCarritoDto, {
        articuloId: 11,
        cantidad,
      });
      expect(mensajes).toHaveLength(1);
      expect(mensajes[0]).toContain('La cantidad debe ser un número entero');
    }
  });

  it('no admite campos de más, como un precio', async () => {
    expect(
      await probar(AgregarArticuloCarritoDto, {
        articuloId: 11,
        cantidad: 1,
        precio: 1,
      }),
    ).toEqual(['El campo «precio» no se admite.']);
  });
});

describe('CambiarCantidadCarritoDto', () => {
  it('acepta una cantidad válida y rechaza una inválida', async () => {
    expect(await probar(CambiarCantidadCarritoDto, { cantidad: 4 })).toEqual(
      [],
    );
    expect(
      await probar(CambiarCantidadCarritoDto, { cantidad: 0 }),
    ).toHaveLength(1);
    expect(await probar(CambiarCantidadCarritoDto, {})).toEqual([
      'La cantidad es obligatoria.',
    ]);
  });
});
