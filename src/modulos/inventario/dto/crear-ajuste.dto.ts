import { ApiProperty } from '@nestjs/swagger';
import { EnteroDistintoDeCero } from '../../../common/validacion/entero-distinto-de-cero.js';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';

/** Largo máximo del motivo de un ajuste. */
export const MAXIMO_MOTIVO_AJUSTE = 500;

/**
 * Ajuste de stock (E11-H4, RF-11.07): corrige la diferencia entre el conteo físico y el stock
 * registrado de un formato en una ubicación. La cantidad lleva signo: +3 suma, -2 descuenta.
 */
export class CrearAjusteDto {
  @ApiProperty({ example: 11, description: 'Id del formato que se ajusta.' })
  @IdEntero({
    faltante: 'El formato es obligatorio.',
    invalido: 'El formato indicado no es válido.',
  })
  formatoId: number;

  @ApiProperty({
    example: 1,
    description: 'Id de la ubicación cuyo stock se ajusta.',
  })
  @IdEntero({
    faltante: 'La ubicación es obligatoria.',
    invalido: 'La ubicación indicada no es válida.',
  })
  ubicacionId: number;

  @ApiProperty({
    example: -2,
    description:
      'Diferencia con el stock registrado: positiva suma, negativa descuenta. Nunca 0.',
  })
  @EnteroDistintoDeCero({ etiqueta: 'La cantidad', femenino: true })
  cantidad: number;

  @ApiProperty({
    example: 'Conteo físico del 25 de octubre: faltan 2 unidades',
    maxLength: MAXIMO_MOTIVO_AJUSTE,
    description: 'Motivo del ajuste; queda en la observación del movimiento.',
  })
  @TextoObligatorio({
    etiqueta: 'El motivo del ajuste',
    maximo: MAXIMO_MOTIVO_AJUSTE,
  })
  observacion: string;
}
