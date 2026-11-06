import { ApiProperty, PickType } from '@nestjs/swagger';
import { CrearCampanaDto } from './crear-campana.dto.js';

/**
 * Entrada de la vista previa en vivo (SCRUM-150): solo lo que se ve en el correo. Sin segmento:
 * no cuenta destinatarios ni guarda nada.
 */
export class RenderizarCampanaDto extends PickType(CrearCampanaDto, [
  'asunto',
  'cuerpo',
] as const) {}

/**
 * El correo tal como saldría, sin `confirmacion`: con esta vista previa no se puede enviar. La que
 * confirma el envío es la de `POST /:id/vista-previa`, sobre el borrador guardado.
 */
export class CorreoCampanaDto {
  @ApiProperty({ example: 'Nueva línea reparadora' })
  asunto: string;

  @ApiProperty({
    description:
      'HTML del correo. El enlace de baja lleva a la pantalla de baja sin token.',
  })
  html: string;

  @ApiProperty({ description: 'Versión en texto plano del correo.' })
  texto: string;
}
