import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Cambios sobre una categoría (E3-H4). Solo se modifica lo que llega en el cuerpo.
 * Mover la categoría es cambiar su `padreId`; con `null` pasa a ser categoría raíz.
 */
export class ActualizarCategoriaDto {
  @ApiPropertyOptional({ example: 'Shampoos', maxLength: 100 })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la categoría no puede quedar vacío.' })
  @MaxLength(100)
  nombre?: string;

  @ApiPropertyOptional({
    example: 'Limpieza y cuidado del cuero cabelludo',
    maxLength: 255,
  })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(255)
  descripcion?: string;

  @ApiPropertyOptional({
    example: 2,
    nullable: true,
    description:
      'Id de la nueva categoría padre. `null` la deja como categoría raíz. No puede ser ella misma ni una de sus subcategorías.',
  })
  @ValidateIf((_objeto, valor) => valor !== undefined && valor !== null)
  @IsInt()
  @Min(1)
  padreId?: number | null;
}
