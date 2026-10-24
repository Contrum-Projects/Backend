import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

/**
 * Entrada para crear una categoría o una subcategoría (E3-H4, RF-03.06).
 * Con `padreId` es una subcategoría de esa categoría; sin él, una categoría raíz.
 */
export class CrearCategoriaDto {
  @ApiProperty({ example: 'Shampoos', maxLength: 100 })
  @TextoObligatorio({ etiqueta: 'El nombre de la categoría', maximo: 100 })
  nombre: string;

  @ApiPropertyOptional({
    example: 'Limpieza y cuidado del cuero cabelludo',
    maxLength: 255,
  })
  @TextoOpcional({ etiqueta: 'La descripción', maximo: 255 })
  descripcion?: string | null;

  @ApiPropertyOptional({
    example: 1,
    description:
      'Id de la categoría que la contiene. Sin él, queda como categoría raíz.',
  })
  @IdEntero({
    faltante: 'La categoría padre no es válida.',
    invalido: 'La categoría padre no es válida.',
    opcional: true,
  })
  padreId?: number;
}
