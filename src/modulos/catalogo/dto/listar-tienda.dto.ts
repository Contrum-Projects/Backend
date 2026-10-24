import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IdEntero } from '../../../common/validacion/id-entero.js';

/** Búsqueda, filtros y paginación del listado público de productos (E2-H1 y E2-H2). */
export class ListarTiendaDto {
  @ApiPropertyOptional({
    description:
      'Texto a buscar, sin distinguir mayúsculas. Cada palabra debe estar en el nombre del producto, en su marca o en su categoría o subcategoría. Vacío no filtra.',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'La búsqueda no es válida.' })
  // PostgreSQL rechaza el byte nulo en un texto: sin esto respondería 500
  // oxlint-disable-next-line no-control-regex
  @Matches(/^[^\u0000-\u001f\u007f]*$/, {
    message: 'La búsqueda no es válida.',
  })
  @MaxLength(100, {
    message: 'La búsqueda no puede superar los 100 caracteres.',
  })
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
