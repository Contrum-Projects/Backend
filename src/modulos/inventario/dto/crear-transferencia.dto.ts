import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { NumeroPositivo } from '../../../common/validacion/numero-positivo.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

/** Largo máximo de la observación de una transferencia. */
export const MAXIMO_OBSERVACION_TRANSFERENCIA = 500;

/**
 * Transferencia de stock (E11-H4, RF-11.08): mueve unidades de un formato de una ubicación a
 * otra, de la misma bodega o de otra.
 */
export class CrearTransferenciaDto {
  @ApiProperty({ example: 11, description: 'Id del formato que se mueve.' })
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
    faltante: 'La ubicación de origen es obligatoria.',
    invalido: 'La ubicación de origen indicada no es válida.',
  })
  ubicacionOrigenId: number;

  @ApiProperty({
    example: 2,
    description:
      'Id de la ubicación que recibe el stock (activa, de bodega activa).',
  })
  @IdEntero({
    faltante: 'La ubicación de destino es obligatoria.',
    invalido: 'La ubicación de destino indicada no es válida.',
  })
  ubicacionDestinoId: number;

  @ApiProperty({ example: 5, minimum: 1 })
  @NumeroPositivo({ etiqueta: 'La cantidad', femenino: true })
  cantidad: number;

  @ApiPropertyOptional({
    example: 'Reposición de la góndola',
    maxLength: MAXIMO_OBSERVACION_TRANSFERENCIA,
    nullable: true,
  })
  @TextoOpcional({
    etiqueta: 'La observación',
    maximo: MAXIMO_OBSERVACION_TRANSFERENCIA,
  })
  observacion?: string | null;
}
