import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, ValidateIf } from 'class-validator';
import { UNIDADES_MEDIDA } from '../../../common/dominio/valores.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { MAXIMO_CONTENIDO, MAXIMO_MEDIDA_CM } from './crear-formato.dto.js';
import { FechaSinHora } from '../../../common/validacion/fecha-sin-hora.js';
import { NumeroPositivo } from '../../../common/validacion/numero-positivo.js';
import { CodigoBarras, Sku } from './formato.validadores.js';

const UNIDADES = Object.values(UNIDADES_MEDIDA);

/**
 * Cambios sobre un formato (E3-H2). Solo se modifica lo que llega. En los datos opcionales
 * (código de barras, contenido con su unidad y fecha de vencimiento) `null` los borra; los
 * demás no pueden quedar vacíos. Contenido y unidad se cambian juntos.
 */
export class ActualizarFormatoDto {
  @ApiPropertyOptional({ example: 'SHA-REP-300', maxLength: 50 })
  @Sku({ presencia: 'puedeFaltar' })
  sku?: string;

  @ApiPropertyOptional({ example: '7801234567890', nullable: true })
  @CodigoBarras()
  codigoBarras?: string | null;

  @ApiPropertyOptional({ example: '300 ml', maxLength: 100 })
  @TextoObligatorio({
    etiqueta: 'El nombre del formato',
    maximo: 100,
    puedeFaltar: true,
  })
  nombreFormato?: string;

  @ApiPropertyOptional({ example: 300, nullable: true })
  @NumeroPositivo({
    etiqueta: 'El contenido',
    decimales: true,
    maximo: MAXIMO_CONTENIDO,
    presencia: 'borrable',
  })
  contenido?: number | null;

  @ApiPropertyOptional({ enum: UNIDADES, nullable: true })
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
    nullable: true,
  })
  @FechaSinHora({ etiqueta: 'La fecha de vencimiento' })
  fechaVencimiento?: string | null;

  @ApiPropertyOptional({ example: 5, minimum: 0 })
  @NumeroPositivo({
    etiqueta: 'El stock mínimo',
    admiteCero: true,
    presencia: 'puedeFaltar',
  })
  stockMinimo?: number;

  @ApiPropertyOptional({ example: 320 })
  @NumeroPositivo({ etiqueta: 'El peso', presencia: 'puedeFaltar' })
  pesoGramos?: number;

  @ApiPropertyOptional({ example: 18.5 })
  @NumeroPositivo({
    etiqueta: 'El alto',
    decimales: true,
    maximo: MAXIMO_MEDIDA_CM,
    presencia: 'puedeFaltar',
  })
  altoCm?: number;

  @ApiPropertyOptional({ example: 6 })
  @NumeroPositivo({
    etiqueta: 'El ancho',
    decimales: true,
    maximo: MAXIMO_MEDIDA_CM,
    presencia: 'puedeFaltar',
  })
  anchoCm?: number;

  @ApiPropertyOptional({ example: 4 })
  @NumeroPositivo({
    etiqueta: 'El largo',
    decimales: true,
    maximo: MAXIMO_MEDIDA_CM,
    presencia: 'puedeFaltar',
  })
  largoCm?: number;

  @ApiPropertyOptional({
    description:
      'Con `true` queda como el único predeterminado del producto. No se puede desmarcar: se marca otro.',
  })
  @IsOptional()
  @IsBoolean({
    message: 'El formato predeterminado debe ser verdadero o falso.',
  })
  esPredeterminado?: boolean;
}
