import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, ValidateBy } from 'class-validator';
import { ESTADOS_PEDIDO } from '../../../common/dominio/valores.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

/** Largo máximo del comentario con que el personal cambia el estado de un pedido. */
export const MAXIMO_COMENTARIO_ESTADO = 500;

/** La API de Chilexpress recibe la OT como número JSON: más dígitos perderían precisión. */
export const MAXIMO_CODIGO_SEGUIMIENTO = 15;

const ESTADOS = Object.values(ESTADOS_PEDIDO);

/** Solo dígitos; el largo y el tipo los revisa `TextoOpcional`. */
const FormatoCodigoSeguimiento = () =>
  ValidateBy({
    name: 'formatoCodigoSeguimiento',
    validator: {
      validate: (valor: unknown) =>
        typeof valor !== 'string' || /^\d*$/.test(valor),
      defaultMessage: () => 'El código de seguimiento solo admite números.',
    },
  });

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

  @ApiPropertyOptional({
    example: '990000000001',
    maxLength: MAXIMO_CODIGO_SEGUIMIENTO,
    description:
      'Número de la orden de transporte de Chilexpress. Es obligatorio al pasar a despachado y no se admite en otro cambio.',
  })
  @TextoOpcional({
    etiqueta: 'El código de seguimiento',
    maximo: MAXIMO_CODIGO_SEGUIMIENTO,
  })
  @FormatoCodigoSeguimiento()
  codigoSeguimiento?: string;
}
