import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn } from 'class-validator';
import { ESTADOS_PEDIDO } from '../../../common/dominio/valores.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

/** Largo máximo del comentario con que el personal cambia el estado de un pedido. */
export const MAXIMO_COMENTARIO_ESTADO = 500;

const ESTADOS = Object.values(ESTADOS_PEDIDO);

/** Cambio del estado de un pedido por el personal (E8-H2, RF-08.02). */
export class CambiarEstadoPedidoDto {
  @ApiProperty({
    enum: ESTADOS,
    example: ESTADOS_PEDIDO.EN_PREPARACION,
    description: 'Estado al que pasa el pedido.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsIn(ESTADOS, {
    message: ({ value }) =>
      value === undefined || value === null || value === ''
        ? 'El estado es obligatorio.'
        : `El estado debe ser uno de estos: ${ESTADOS.join(', ')}.`,
  })
  estado!: string;

  @ApiPropertyOptional({
    example: 'Pedido armado y revisado.',
    maxLength: MAXIMO_COMENTARIO_ESTADO,
    description:
      'Nota interna que queda en el historial. Es obligatoria al volver a un estado anterior.',
  })
  @TextoOpcional({
    etiqueta: 'El comentario',
    maximo: MAXIMO_COMENTARIO_ESTADO,
  })
  comentario?: string;
}
