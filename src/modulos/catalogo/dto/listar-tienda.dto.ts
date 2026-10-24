import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { Paginacion } from '../../../common/validacion/paginacion.js';
import { TextoBusqueda } from '../../../common/validacion/texto-busqueda.js';

/** Búsqueda, filtros y paginación del listado público de productos (E2-H1 y E2-H2). */
export class ListarTiendaDto extends Paginacion {
  @ApiPropertyOptional({
    description:
      'Texto a buscar, sin distinguir mayúsculas. Cada palabra debe estar en el nombre del producto, en su marca o en su categoría o subcategoría. Hasta 5 palabras. Vacío no filtra.',
    maxLength: 100,
  })
  @TextoBusqueda({ maximo: 100, maximoPalabras: 5 })
  buscar?: string;

  @ApiPropertyOptional({
    description:
      'Productos de esta categoría y de todas sus subcategorías, a cualquier profundidad.',
  })
  @Type(() => Number)
  @IdEntero({
    faltante: 'La categoría indicada no es válida.',
    invalido: 'La categoría indicada no es válida.',
    opcional: true,
  })
  categoriaId?: number;

  @ApiPropertyOptional({ description: 'Solo productos de esta marca.' })
  @Type(() => Number)
  @IdEntero({
    faltante: 'La marca indicada no es válida.',
    invalido: 'La marca indicada no es válida.',
    opcional: true,
  })
  marcaId?: number;
}
