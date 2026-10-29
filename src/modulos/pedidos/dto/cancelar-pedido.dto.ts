import { ApiPropertyOptional } from '@nestjs/swagger';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

/** Largo máximo del comentario con que el personal cancela un pedido. */
export const MAXIMO_COMENTARIO_CANCELACION = 500;

/** Cancelación de un pedido pendiente de pago por el personal (E8-H3, RF-08.05). */
export class CancelarPedidoDto {
  @ApiPropertyOptional({
    example: 'El cliente pidió anular la compra.',
    maxLength: MAXIMO_COMENTARIO_CANCELACION,
    description: 'Motivo de la cancelación; queda en el historial del pedido.',
  })
  @TextoOpcional({
    etiqueta: 'El comentario',
    maximo: MAXIMO_COMENTARIO_CANCELACION,
  })
  comentario?: string;
}
