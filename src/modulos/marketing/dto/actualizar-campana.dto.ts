import { ApiPropertyOptional } from '@nestjs/swagger';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import {
  AsuntoDeUnaLinea,
  MAXIMO_ASUNTO_CAMPANA,
  MAXIMO_CUERPO_CAMPANA,
} from './crear-campana.dto.js';
import { Segmento, SegmentoCampanaDto } from './segmento-campana.dto.js';

/** Edición de un borrador de campaña (E12-H3): cada campo que llega reemplaza al anterior. */
export class ActualizarCampanaDto {
  @ApiPropertyOptional({ maxLength: MAXIMO_ASUNTO_CAMPANA })
  @TextoObligatorio({
    etiqueta: 'El asunto de la campaña',
    maximo: MAXIMO_ASUNTO_CAMPANA,
    puedeFaltar: true,
  })
  @AsuntoDeUnaLinea()
  asunto?: string;

  @ApiPropertyOptional({ maxLength: MAXIMO_CUERPO_CAMPANA })
  @TextoObligatorio({
    etiqueta: 'El cuerpo de la campaña',
    maximo: MAXIMO_CUERPO_CAMPANA,
    puedeFaltar: true,
  })
  cuerpo?: string;

  @ApiPropertyOptional({
    type: SegmentoCampanaDto,
    description: 'Reemplaza el segmento completo.',
  })
  @Segmento({ puedeFaltar: true })
  segmento?: SegmentoCampanaDto;
}
