import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsIn, IsOptional } from 'class-validator';
import { ORDENES_TIENDA } from '../../../common/dominio/valores.js';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { Paginacion } from '../../../common/validacion/paginacion.js';
import { TextoBusqueda } from '../../../common/validacion/texto-busqueda.js';

const ORDENES = Object.values(ORDENES_TIENDA);

/** Tope de categorías o de marcas marcadas a la vez: acota el costo de la consulta. */
export const MAXIMO_FILTROS_TIENDA = 30;

/**
 * Un parámetro que puede repetirse (`?categoriaId=3&categoriaId=5`) llega como texto o lista de
 * textos: queda como lista de números. Lo que no es número se deja tal cual para que el
 * validador responda con su mensaje.
 */
const comoLista = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return (Array.isArray(value) ? value : [value]).map((elemento) =>
    typeof elemento === 'string' && /^\d+$/.test(elemento)
      ? Number(elemento)
      : elemento,
  );
};

/** Búsqueda y filtros de la tienda, sin paginación: los comparten el listado y las facetas. */
export class FiltrosTiendaDto {
  @ApiPropertyOptional({
    description:
      'Texto a buscar, sin distinguir mayúsculas. Cada palabra debe estar en el nombre del producto, en su marca o en su categoría o subcategoría. Hasta 5 palabras. Vacío no filtra.',
    maxLength: 100,
  })
  @TextoBusqueda({ maximo: 100, maximoPalabras: 5 })
  buscar?: string;

  @ApiPropertyOptional({
    type: [Number],
    description:
      'Productos de estas categorías y de todas sus subcategorías, a cualquier profundidad. Se repite para marcar varias (`categoriaId=3&categoriaId=5`): basta estar en una.',
  })
  @Transform(comoLista)
  @ArrayMaxSize(MAXIMO_FILTROS_TIENDA, {
    message: `Puedes marcar hasta ${MAXIMO_FILTROS_TIENDA} categorías.`,
  })
  @IdEntero({
    faltante: 'La categoría indicada no es válida.',
    invalido: 'La categoría indicada no es válida.',
    opcional: true,
    each: true,
  })
  categoriaId?: number[];

  @ApiPropertyOptional({
    type: [Number],
    description:
      'Productos de estas marcas. Se repite para marcar varias: basta ser de una. Entre categorías y marcas se exigen las dos.',
  })
  @Transform(comoLista)
  @ArrayMaxSize(MAXIMO_FILTROS_TIENDA, {
    message: `Puedes marcar hasta ${MAXIMO_FILTROS_TIENDA} marcas.`,
  })
  @IdEntero({
    faltante: 'La marca indicada no es válida.',
    invalido: 'La marca indicada no es válida.',
    opcional: true,
    each: true,
  })
  marcaId?: number[];
}

/**
 * Búsqueda, filtros y paginación del listado público de productos (E2-H1 y E2-H2).
 * `IntersectionType` copia también las validaciones y transformaciones de las dos clases.
 */
export class ListarTiendaDto extends IntersectionType(
  FiltrosTiendaDto,
  Paginacion,
) {
  @ApiPropertyOptional({
    enum: ORDENES,
    description:
      'Sin él, por nombre. `mas-vendidos`: unidades vendidas en los últimos 30 días en pedidos pagados (no cancelados); `novedades`: los creados más recientemente. Los empates, por nombre.',
  })
  @IsOptional()
  @IsIn(ORDENES, {
    message: `El orden debe ser uno de estos: ${ORDENES.join(', ')}.`,
  })
  orden?: (typeof ORDENES)[number];
}
