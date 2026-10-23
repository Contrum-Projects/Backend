import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, ValidateIf } from 'class-validator';
import { CANALES_VENTA } from '../../../common/dominio/valores.js';

const CANALES = Object.values(CANALES_VENTA);

/**
 * Canal de venta del producto: uno de `CANALES_VENTA`. Un solo mensaje en español, distinto
 * si falta el dato o si llega un valor que no existe.
 */
export function CanalVenta({ puedeFaltar }: { puedeFaltar?: boolean } = {}) {
  const decoradores = [
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    IsIn(CANALES, {
      message: ({ value }) =>
        value === undefined || value === null || value === ''
          ? 'El canal de venta es obligatorio.'
          : `El canal de venta debe ser uno de estos: ${CANALES.join(', ')}.`,
    }),
  ];
  if (puedeFaltar) {
    decoradores.unshift(ValidateIf((_objeto, valor) => valor !== undefined));
  }
  return applyDecorators(...decoradores);
}
