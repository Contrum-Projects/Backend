import { ApiProperty } from '@nestjs/swagger';
import { Mes } from '../../../common/validacion/mes.js';

/** Meses del reporte de carritos abandonados (E14-H3): ambos incluidos, en hora de Chile. */
export class ReporteCarritosDto {
  @ApiProperty({
    example: '2026-01',
    pattern: '^(19|20)\\d{2}-(0[1-9]|1[0-2])$',
  })
  @Mes({ etiqueta: 'El mes desde', presencia: 'obligatorio' })
  desde: string;

  @ApiProperty({
    example: '2026-12',
    pattern: '^(19|20)\\d{2}-(0[1-9]|1[0-2])$',
  })
  @Mes({ etiqueta: 'El mes hasta', presencia: 'obligatorio' })
  hasta: string;
}
