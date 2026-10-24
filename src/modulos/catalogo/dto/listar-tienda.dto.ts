import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { IdEntero } from '../../../common/validacion/id-entero.js';

/** Filtros y paginación del listado público de productos (E2-H1). */
export class ListarTiendaDto {
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

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limite?: number;
}
