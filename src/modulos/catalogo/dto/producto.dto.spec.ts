import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mensajesValidacion } from '../../../common/validacion/mensajes-validacion.js';
import { ActualizarProductoDto } from './actualizar-producto.dto.js';
import {
  CrearProductoDto,
  MINIMO_DESCRIPCION_PRODUCTO,
} from './crear-producto.dto.js';

const mensajes = async (datos: object) =>
  mensajesValidacion(await validate(plainToInstance(CrearProductoDto, datos)));

const mensajesEdicion = async (datos: object) =>
  mensajesValidacion(
    await validate(plainToInstance(ActualizarProductoDto, datos)),
  );

const MENSAJE_CORTA = `La descripción del producto debe tener al menos ${MINIMO_DESCRIPCION_PRODUCTO} caracteres.`;

const productoBase = () => ({
  nombre: 'Shampoo reparador',
  descripcion:
    'Repara el cabello dañado por procesos químicos y le devuelve su brillo natural.',
  categoriaId: 1,
  marcaId: 1,
  canalVenta: 'general',
});

describe('CrearProductoDto · descripción', () => {
  it(`acepta una descripción de ${MINIMO_DESCRIPCION_PRODUCTO} caracteres o más`, async () => {
    expect(await mensajes(productoBase())).toEqual([]);
    expect(
      await mensajes({
        ...productoBase(),
        descripcion: 'x'.repeat(MINIMO_DESCRIPCION_PRODUCTO),
      }),
    ).toEqual([]);
  });

  it(`rechaza una descripción de menos de ${MINIMO_DESCRIPCION_PRODUCTO} caracteres`, async () => {
    expect(
      await mensajes({
        ...productoBase(),
        descripcion: 'x'.repeat(MINIMO_DESCRIPCION_PRODUCTO - 1),
      }),
    ).toEqual([MENSAJE_CORTA]);
  });

  it('cuenta el largo sin los espacios de los extremos', async () => {
    const corta = `   ${'x'.repeat(MINIMO_DESCRIPCION_PRODUCTO - 1)}   `;
    expect(await mensajes({ ...productoBase(), descripcion: corta })).toEqual([
      MENSAJE_CORTA,
    ]);
  });

  it('una descripción vacía sigue indicando que es obligatoria', async () => {
    expect(await mensajes({ ...productoBase(), descripcion: '  ' })).toEqual([
      'La descripción del producto es obligatoria.',
    ]);
  });
});

describe('ActualizarProductoDto · descripción', () => {
  it('sin descripción en el cuerpo no la valida', async () => {
    expect(await mensajesEdicion({ nombre: 'Shampoo reparador' })).toEqual([]);
  });

  it(`si llega, exige al menos ${MINIMO_DESCRIPCION_PRODUCTO} caracteres`, async () => {
    expect(
      await mensajesEdicion({
        descripcion: 'x'.repeat(MINIMO_DESCRIPCION_PRODUCTO - 1),
      }),
    ).toEqual([MENSAJE_CORTA]);
    expect(
      await mensajesEdicion({
        descripcion: 'x'.repeat(MINIMO_DESCRIPCION_PRODUCTO),
      }),
    ).toEqual([]);
  });
});
