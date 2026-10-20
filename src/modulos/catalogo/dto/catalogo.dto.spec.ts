import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ActualizarCategoriaDto } from './actualizar-categoria.dto.js';
import { CrearCategoriaDto } from './crear-categoria.dto.js';
import { CrearMarcaDto } from './crear-marca.dto.js';

const errores = async <T extends object>(clase: new () => T, datos: object) =>
  (await validate(plainToInstance(clase, datos))).map((e) => e.property);

describe('DTOs del catálogo', () => {
  describe('CrearMarcaDto', () => {
    it('acepta un nombre y le quita los espacios de los bordes', async () => {
      const dto = plainToInstance(CrearMarcaDto, { nombre: '  Kerastase  ' });

      expect(await validate(dto)).toHaveLength(0);
      expect(dto.nombre).toBe('Kerastase');
    });

    it('rechaza un nombre vacío, ausente o más largo que la columna', async () => {
      expect(await errores(CrearMarcaDto, { nombre: '   ' })).toEqual([
        'nombre',
      ]);
      expect(await errores(CrearMarcaDto, {})).toEqual(['nombre']);
      expect(await errores(CrearMarcaDto, { nombre: 'a'.repeat(101) })).toEqual(
        ['nombre'],
      );
    });
  });

  describe('CrearCategoriaDto', () => {
    it('acepta solo el nombre y también nombre, descripción y padreId', async () => {
      expect(await errores(CrearCategoriaDto, { nombre: 'Shampoos' })).toEqual(
        [],
      );
      expect(
        await errores(CrearCategoriaDto, {
          nombre: 'Shampoos',
          descripcion: 'Limpieza',
          padreId: 3,
        }),
      ).toEqual([]);
    });

    it('rechaza nombre vacío, padreId que no es entero positivo y descripción larga', async () => {
      expect(await errores(CrearCategoriaDto, { nombre: ' ' })).toEqual([
        'nombre',
      ]);
      expect(
        await errores(CrearCategoriaDto, { nombre: 'X', padreId: 0 }),
      ).toEqual(['padreId']);
      expect(
        await errores(CrearCategoriaDto, { nombre: 'X', padreId: 1.5 }),
      ).toEqual(['padreId']);
      expect(
        await errores(CrearCategoriaDto, { nombre: 'X', padreId: '2' }),
      ).toEqual(['padreId']);
      expect(
        await errores(CrearCategoriaDto, {
          nombre: 'X',
          descripcion: 'a'.repeat(256),
        }),
      ).toEqual(['descripcion']);
    });
  });

  describe('ActualizarCategoriaDto', () => {
    it('acepta cualquier subconjunto de campos y padreId null para pasar a raíz', async () => {
      expect(await errores(ActualizarCategoriaDto, {})).toEqual([]);
      expect(
        await errores(ActualizarCategoriaDto, { nombre: 'Nuevo' }),
      ).toEqual([]);
      expect(await errores(ActualizarCategoriaDto, { padreId: 2 })).toEqual([]);
      expect(await errores(ActualizarCategoriaDto, { padreId: null })).toEqual(
        [],
      );
    });

    it('rechaza un nombre vacío y un padreId inválido', async () => {
      expect(await errores(ActualizarCategoriaDto, { nombre: '  ' })).toEqual([
        'nombre',
      ]);
      expect(await errores(ActualizarCategoriaDto, { padreId: -1 })).toEqual([
        'padreId',
      ]);
      expect(await errores(ActualizarCategoriaDto, { padreId: 'uno' })).toEqual(
        ['padreId'],
      );
    });
  });
});
