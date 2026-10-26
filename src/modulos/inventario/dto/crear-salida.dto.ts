import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn } from 'class-validator';
import { TIPOS_SALIDA } from '../../../common/dominio/valores.js';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { NumeroPositivo } from '../../../common/validacion/numero-positivo.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

/** Largo máximo de la observación de una salida. */
export const MAXIMO_OBSERVACION_SALIDA = 500;

/**
 * Salida de inventario que no es venta (E11-H3, RF-11.06): merma por vencimiento, merma por daño
 * o consumo en la peluquería, de un formato en una ubicación.
 */
export class CrearSalidaDto {
  @ApiProperty({ example: 11, description: 'Id del formato que sale.' })
  @IdEntero({
    faltante: 'El formato es obligatorio.',
    invalido: 'El formato indicado no es válido.',
  })
  formatoId: number;

  @ApiProperty({
    example: 1,
    description: 'Id de la ubicación de la que sale el stock.',
  })
  @IdEntero({
    faltante: 'La ubicación es obligatoria.',
    invalido: 'La ubicación indicada no es válida.',
  })
  ubicacionId: number;

  @ApiProperty({ enum: TIPOS_SALIDA, example: TIPOS_SALIDA[1] })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsIn(TIPOS_SALIDA, {
    message: `El tipo de salida es obligatorio y debe ser uno de estos: ${TIPOS_SALIDA.join(', ')}.`,
  })
  tipo: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @NumeroPositivo({ etiqueta: 'La cantidad', femenino: true })
  cantidad: number;

  @ApiPropertyOptional({
    example: 'Envase roto al reponer',
    maxLength: MAXIMO_OBSERVACION_SALIDA,
    nullable: true,
  })
  @TextoOpcional({
    etiqueta: 'La observación',
    maximo: MAXIMO_OBSERVACION_SALIDA,
  })
  observacion?: string | null;
}
