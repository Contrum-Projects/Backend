import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { NumeroPositivo } from '../../../common/validacion/numero-positivo.js';

/** Máximo de la columna `Decimal(12, 2)` de los precios netos. */
export const MAXIMO_PRECIO_NETO = 9_999_999_999.99;
/** Largo máximo del motivo de un cambio de precio (E3-H5, decisión del 24 oct). */
export const MAXIMO_MOTIVO_PRECIO = 500;

/**
 * Nuevos precios netos de un artículo y el motivo del cambio (E3-H5, RF-03.07 y RF-03.08).
 * Llega al menos uno de los dos precios; el que no llega no cambia. Un artículo exclusivo para
 * profesionales solo lleva precio mayorista.
 */
export class FijarPreciosDto {
  @ApiPropertyOptional({
    example: 8403.36,
    description:
      'Precio minorista neto (sin IVA), con hasta dos decimales. No se admite en un artículo exclusivo para profesionales.',
  })
  @NumeroPositivo({
    etiqueta: 'El precio minorista neto',
    decimales: true,
    maximo: MAXIMO_PRECIO_NETO,
    presencia: 'puedeFaltar',
  })
  precioMinoristaNeto?: number;

  @ApiPropertyOptional({
    example: 6722.69,
    description: 'Precio mayorista neto (sin IVA), con hasta dos decimales.',
  })
  @NumeroPositivo({
    etiqueta: 'El precio mayorista neto',
    decimales: true,
    maximo: MAXIMO_PRECIO_NETO,
    presencia: 'puedeFaltar',
  })
  precioMayoristaNeto?: number;

  @ApiProperty({
    example: 'Alza del proveedor',
    maxLength: MAXIMO_MOTIVO_PRECIO,
  })
  @TextoObligatorio({ etiqueta: 'El motivo', maximo: MAXIMO_MOTIVO_PRECIO })
  motivo: string;
}
