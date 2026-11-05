import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { TIPOS_DESTINATARIO_CAMPANA } from '../../../common/dominio/valores.js';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import type { TipoDestinatario } from '../segmento-campana.js';

/** Categorías o marcas que puede nombrar un segmento: acota la consulta de destinatarios. */
export const MAXIMO_FILTROS_SEGMENTO = 50;

const TIPOS: readonly string[] = Object.values(TIPOS_DESTINATARIO_CAMPANA);

/** Lista opcional de ids (categorías o marcas), sin pasar del máximo. */
const ListaDeIds = (etiqueta: string, invalido: string) =>
  applyDecorators(
    ValidateIf((_objeto, valor) => valor !== undefined),
    IsArray({ message: `${etiqueta} deben ser una lista.` }),
    ArrayMaxSize(MAXIMO_FILTROS_SEGMENTO, {
      message: `Indica hasta ${MAXIMO_FILTROS_SEGMENTO} ${etiqueta.toLowerCase()}.`,
    }),
    IdEntero({ faltante: invalido, invalido, each: true }),
  );

/**
 * A quién va una campaña (E12-H3, decisión del 5 de noviembre de 2026). Que las categorías y
 * marcas existan, y que no se pidan suscriptores con un filtro de compras, lo revisa el servicio.
 */
export class SegmentoCampanaDto {
  @ApiProperty({
    enum: TIPOS,
    isArray: true,
    example: [TIPOS_DESTINATARIO_CAMPANA.CLIENTE],
    description:
      'Al menos uno. `suscriptor`: personas suscritas a ofertas sin cuenta. Solo reciben quienes aceptaron publicidad.',
  })
  @ValidateBy({
    name: 'tiposDestinatario',
    validator: {
      validate: (valor: unknown) =>
        Array.isArray(valor) &&
        valor.length > 0 &&
        valor.length <= TIPOS.length * 2 &&
        valor.every((tipo) => typeof tipo === 'string' && TIPOS.includes(tipo)),
      defaultMessage: () =>
        `Indica a quién va la campaña: ${TIPOS.join(', ')}.`,
    },
  })
  tipos: TipoDestinatario[];

  @ApiPropertyOptional({
    type: [Number],
    example: [3],
    maxItems: MAXIMO_FILTROS_SEGMENTO,
    description:
      'Solo cuentas que compraron algún producto de estas categorías (o sus subcategorías) o de las marcas indicadas.',
  })
  @ListaDeIds('Las categorías', 'Alguna categoría indicada no es válida.')
  categorias?: number[];

  @ApiPropertyOptional({
    type: [Number],
    example: [7],
    maxItems: MAXIMO_FILTROS_SEGMENTO,
    description:
      'Solo cuentas que compraron algún producto de estas marcas o de las categorías indicadas.',
  })
  @ListaDeIds('Las marcas', 'Alguna marca indicada no es válida.')
  marcas?: number[];
}

/** El segmento como campo de una campaña: un objeto que se valida entero. */
export const Segmento = ({ puedeFaltar }: { puedeFaltar?: boolean } = {}) => {
  const decoradores = [
    Type(() => SegmentoCampanaDto),
    IsObject({ message: 'Indica el segmento de la campaña.' }),
    ValidateNested({ message: 'Indica el segmento de la campaña.' }),
  ];
  if (puedeFaltar) {
    decoradores.unshift(ValidateIf((_objeto, valor) => valor !== undefined));
  }
  return applyDecorators(...decoradores);
};
