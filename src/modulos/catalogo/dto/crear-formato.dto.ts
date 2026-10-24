import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, ValidateIf } from 'class-validator';
import { UNIDADES_MEDIDA } from '../../../common/dominio/valores.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import {
  CodigoBarras,
  FechaSinHora,
  NumeroPositivo,
  Sku,
} from './formato.validadores.js';

const UNIDADES = Object.values(UNIDADES_MEDIDA);

/** Máximos de las columnas `Decimal(10, 2)` (contenido) y `Decimal(7, 2)` (medidas). */
export const MAXIMO_CONTENIDO = 99_999_999.99;
export const MAXIMO_MEDIDA_CM = 99_999.99;

/**
 * Entrada para crear un formato de venta de un producto (E3-H2, RF-03.02 y RF-03.03).
 * El formato nace activo y sin precios: se fijan en E3-H5 y, mientras falten, la tienda no lo
 * muestra. Contenido y unidad de medida van juntos o no van.
 */
export class CrearFormatoDto {
  @ApiProperty({ example: 'SHA-REP-300', maxLength: 50 })
  @Sku()
  sku: string;

  @ApiPropertyOptional({
    example: '7801234567890',
    description: '8, 12, 13 o 14 dígitos. Único entre todos los formatos.',
    nullable: true,
  })
  @CodigoBarras()
  codigoBarras?: string | null;

  @ApiProperty({ example: '300 ml', maxLength: 100 })
  @TextoObligatorio({ etiqueta: 'El nombre del formato', maximo: 100 })
  nombreFormato: string;

  @ApiPropertyOptional({ example: 300, nullable: true })
  @NumeroPositivo({
    etiqueta: 'El contenido',
    decimales: true,
    maximo: MAXIMO_CONTENIDO,
    presencia: 'borrable',
  })
  contenido?: number | null;

  @ApiPropertyOptional({
    enum: UNIDADES,
    example: UNIDADES_MEDIDA.ML,
    nullable: true,
  })
  @ValidateIf((_objeto, valor) => valor !== undefined && valor !== null)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsIn(UNIDADES, {
    message: `La unidad de medida debe ser una de estas: ${UNIDADES.join(', ')}.`,
  })
  unidadMedida?: string | null;

  @ApiPropertyOptional({
    example: '2027-12-31',
    format: 'date',
    description:
      'Opcional. Solo se muestra en el panel; no se usa para vender ni para avisar.',
    nullable: true,
  })
  @FechaSinHora({ etiqueta: 'La fecha de vencimiento' })
  fechaVencimiento?: string | null;

  @ApiPropertyOptional({ example: 5, default: 0, minimum: 0 })
  @NumeroPositivo({
    etiqueta: 'El stock mínimo',
    admiteCero: true,
    presencia: 'puedeFaltar',
  })
  stockMinimo?: number;

  @ApiProperty({ example: 320, description: 'Peso en gramos.' })
  @NumeroPositivo({ etiqueta: 'El peso' })
  pesoGramos: number;

  @ApiProperty({ example: 18.5, description: 'Centímetros.' })
  @NumeroPositivo({
    etiqueta: 'El alto',
    decimales: true,
    maximo: MAXIMO_MEDIDA_CM,
  })
  altoCm: number;

  @ApiProperty({ example: 6, description: 'Centímetros.' })
  @NumeroPositivo({
    etiqueta: 'El ancho',
    decimales: true,
    maximo: MAXIMO_MEDIDA_CM,
  })
  anchoCm: number;

  @ApiProperty({ example: 4, description: 'Centímetros.' })
  @NumeroPositivo({
    etiqueta: 'El largo',
    decimales: true,
    maximo: MAXIMO_MEDIDA_CM,
  })
  largoCm: number;

  @ApiPropertyOptional({
    description:
      'Con `true` queda como el único predeterminado del producto. El primer formato de un producto siempre lo es.',
  })
  @IsOptional()
  @IsBoolean({
    message: 'El formato predeterminado debe ser verdadero o falso.',
  })
  esPredeterminado?: boolean;
}
