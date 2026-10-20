import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Entrada para crear una categoría o una subcategoría (E3-H4, RF-03.06).
 * Con `padreId` es una subcategoría de esa categoría; sin él, una categoría raíz.
 */
export class CrearCategoriaDto {
  @ApiProperty({ example: 'Shampoos', maxLength: 100 })
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la categoría es obligatorio.' })
  @MaxLength(100)
  nombre: string;

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
    example: 1,
    description:
      'Id de la categoría que la contiene. Sin él, queda como categoría raíz.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  padreId?: number;
}
