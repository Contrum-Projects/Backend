import { ApiProperty } from '@nestjs/swagger';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';

/** Largo mínimo del motivo de rechazo, ya recortado (decisión del 3 nov 2026, E10-H3). */
export const MINIMO_MOTIVO_RECHAZO = 10;
/** Largo máximo del motivo de rechazo (decisión del 3 nov 2026, E10-H3). */
export const MAXIMO_MOTIVO_RECHAZO = 1000;

/** Rechazo de una solicitud en revisión manual por el personal (E10-H3, RF-10.06). */
export class RechazarSolicitudDto {
  @ApiProperty({
    example:
      'El certificado adjunto no es legible ni indica el nombre del titular.',
    minLength: MINIMO_MOTIVO_RECHAZO,
    maxLength: MAXIMO_MOTIVO_RECHAZO,
    description:
      'Obligatorio. Se recorta y queda guardado en la solicitud; quien solicitó lo ve.',
  })
  @TextoObligatorio({
    etiqueta: 'El motivo del rechazo',
    minimo: MINIMO_MOTIVO_RECHAZO,
    maximo: MAXIMO_MOTIVO_RECHAZO,
  })
  motivo: string;
}
