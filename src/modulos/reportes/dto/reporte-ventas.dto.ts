import { ApiProperty } from '@nestjs/swagger';
import { FechaSinHora } from '../../../common/validacion/fecha-sin-hora.js';

/** Período del reporte de ventas (E14-H2): ambos días incluidos, en hora de Chile. */
export class ReporteVentasDto {
  @ApiProperty({ example: '2026-11-01', format: 'date' })
  @FechaSinHora({ etiqueta: 'La fecha desde', presencia: 'obligatorio' })
  desde: string;

  @ApiProperty({ example: '2026-11-30', format: 'date' })
  @FechaSinHora({ etiqueta: 'La fecha hasta', presencia: 'obligatorio' })
  hasta: string;
}
