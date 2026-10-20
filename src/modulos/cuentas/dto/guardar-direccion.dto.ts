import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** La referencia es opcional: un texto vacío la borra, igual que `null`. */
const recortarOVaciar = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const recortado = value.trim();
  return recortado === '' ? null : recortado;
};

const COMUNA = /^\d{5}$/;
const COMUNA_INVALIDA = 'La comuna no es válida.';

/** Nueva dirección de la cuenta (E1-H5, RF-01.08). */
export class CrearDireccionDto {
  @ApiProperty({ example: 'Av. Providencia', maxLength: 150 })
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'La calle es obligatoria.' })
  @MaxLength(150)
  calle: string;

  @ApiProperty({ example: '1234', maxLength: 20 })
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'El número es obligatorio.' })
  @MaxLength(20)
  numero: string;

  @ApiPropertyOptional({ example: 'Depto. 501', maxLength: 255 })
  @IsOptional()
  @Transform(recortarOVaciar)
  @IsString()
  @MaxLength(255)
  referencia?: string | null;

  @ApiProperty({ example: '13123', description: 'Código CUT de la comuna.' })
  @Matches(COMUNA, { message: COMUNA_INVALIDA })
  comuna: string;

  @ApiPropertyOptional({
    description:
      'Dejarla como principal. La primera dirección de la cuenta siempre queda como principal.',
  })
  @IsOptional()
  @IsBoolean()
  esPrincipal?: boolean;
}

/**
 * Edición de una dirección (E1-H5): solo cambia lo que viene. La principal se cambia con su
 * propia ruta.
 */
export class ActualizarDireccionDto {
  @ApiPropertyOptional({ example: 'Av. Providencia', maxLength: 150 })
  @ValidateIf((_, valor) => valor !== undefined)
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'La calle es obligatoria.' })
  @MaxLength(150)
  calle?: string;

  @ApiPropertyOptional({ example: '1234', maxLength: 20 })
  @ValidateIf((_, valor) => valor !== undefined)
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'El número es obligatorio.' })
  @MaxLength(20)
  numero?: string;

  @ApiPropertyOptional({
    example: 'Depto. 501',
    maxLength: 255,
    nullable: true,
  })
  @IsOptional()
  @Transform(recortarOVaciar)
  @IsString()
  @MaxLength(255)
  referencia?: string | null;

  @ApiPropertyOptional({
    example: '13123',
    description: 'Código CUT de la comuna.',
  })
  @ValidateIf((_, valor) => valor !== undefined)
  @Matches(COMUNA, { message: COMUNA_INVALIDA })
  comuna?: string;
}
