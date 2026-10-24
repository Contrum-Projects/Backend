import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Matches, ValidateIf } from 'class-validator';
import { Booleano } from '../../../common/validacion/booleano.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

const COMUNA = /^\d{5}$/;
const COMUNA_INVALIDA = 'La comuna no es válida.';

/** Nueva dirección de la cuenta (E1-H5, RF-01.07). */
export class CrearDireccionDto {
  @ApiProperty({ example: 'Av. Providencia', maxLength: 150 })
  @TextoObligatorio({ etiqueta: 'La calle', maximo: 150, femenino: true })
  calle: string;

  @ApiProperty({ example: '1234', maxLength: 20 })
  @TextoObligatorio({ etiqueta: 'El número', maximo: 20 })
  numero: string;

  @ApiPropertyOptional({ example: 'Depto. 501', maxLength: 255 })
  @TextoOpcional({ etiqueta: 'La referencia', maximo: 255 })
  referencia?: string | null;

  @ApiProperty({ example: '13123', description: 'Código CUT de la comuna.' })
  @Matches(COMUNA, { message: COMUNA_INVALIDA })
  comuna: string;

  @ApiPropertyOptional({
    description:
      'Dejarla como principal. La primera dirección de la cuenta siempre queda como principal.',
  })
  @Booleano({ etiqueta: 'Dejarla como principal' })
  esPrincipal?: boolean;
}

/**
 * Edición de una dirección (E1-H5, RF-01.09): solo cambia lo que viene. La principal se cambia con su
 * propia ruta.
 */
export class ActualizarDireccionDto {
  @ApiPropertyOptional({ example: 'Av. Providencia', maxLength: 150 })
  @TextoObligatorio({
    etiqueta: 'La calle',
    maximo: 150,
    femenino: true,
    puedeFaltar: true,
  })
  calle?: string;

  @ApiPropertyOptional({ example: '1234', maxLength: 20 })
  @TextoObligatorio({ etiqueta: 'El número', maximo: 20, puedeFaltar: true })
  numero?: string;

  @ApiPropertyOptional({
    example: 'Depto. 501',
    maxLength: 255,
    nullable: true,
  })
  @TextoOpcional({ etiqueta: 'La referencia', maximo: 255 })
  referencia?: string | null;

  @ApiPropertyOptional({
    example: '13123',
    description: 'Código CUT de la comuna.',
  })
  @ValidateIf((_, valor) => valor !== undefined)
  @Matches(COMUNA, { message: COMUNA_INVALIDA })
  comuna?: string;
}
