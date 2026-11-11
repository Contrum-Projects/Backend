import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { CrearCampanaDto } from './crear-campana.dto.js';

/**
 * Entrada de la vista previa en vivo (SCRUM-150): solo lo que se ve en el correo. Sin segmento:
 * no cuenta destinatarios ni guarda nada.
 */
export class RenderizarCampanaDto extends PickType(CrearCampanaDto, [
  'asunto',
  'cuerpo',
] as const) {
  @ApiPropertyOptional({
    example: 12,
    description:
      'El borrador que se está editando: con él, `{cupon}` muestra el código de su cupón activo (SCRUM-150).',
  })
  @IdEntero({
    faltante: 'La campaña indicada no es válida.',
    invalido: 'La campaña indicada no es válida.',
    opcional: true,
  })
  campanaId?: number;
}

/**
 * El correo tal como saldría, sin `confirmacion`: con esta vista previa no se puede enviar. La que
 * confirma el envío es la de `POST /:id/vista-previa`, sobre el borrador guardado.
 */
export class CorreoCampanaDto {
  @ApiProperty({ example: 'Nueva línea reparadora' })
  asunto: string;

  @ApiProperty({
    description: 'HTML del correo, con el correo para pedir la baja en el pie.',
  })
  html: string;

  @ApiProperty({ description: 'Versión en texto plano del correo.' })
  texto: string;
}
