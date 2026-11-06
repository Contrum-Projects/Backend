import { ApiProperty } from '@nestjs/swagger';
import { FechaSinHora } from '../../../common/validacion/fecha-sin-hora.js';

/** Período de un reporte (E14-H1, E14-H2): ambos días incluidos, en hora de Chile. */
export class PeriodoReporteDto {
  @ApiProperty({ example: '2026-11-01', format: 'date' })
  @FechaSinHora({ etiqueta: 'La fecha desde', presencia: 'obligatorio' })
  desde: string;

  @ApiProperty({ example: '2026-11-30', format: 'date' })
  @FechaSinHora({ etiqueta: 'La fecha hasta', presencia: 'obligatorio' })
  hasta: string;
}
