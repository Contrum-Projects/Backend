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
import { Booleano } from '../../../common/validacion/booleano.js';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import type { TipoDestinatario } from '../segmento-campana.js';

/** Categorías o marcas que puede nombrar un segmento: acota la consulta de destinatarios. */
export const MAXIMO_FILTROS_SEGMENTO = 50;

const TIPOS: readonly string[] = Object.values(TIPOS_DESTINATARIO_CAMPANA);

/** Lista opcional de códigos CUT de `digitos` dígitos, sin pasar del máximo. */
const ListaDeCodigos = (etiqueta: string, digitos: number, invalido: string) =>
  applyDecorators(
    ValidateIf((_objeto, valor) => valor !== undefined),
    IsArray({ message: `${etiqueta} deben ser una lista.` }),
    ArrayMaxSize(MAXIMO_FILTROS_SEGMENTO, {
      message: `Indica hasta ${MAXIMO_FILTROS_SEGMENTO} ${etiqueta.toLowerCase()}.`,
    }),
    ValidateBy({
      name: 'codigosCut',
      validator: {
        validate: (valor: unknown) =>
          Array.isArray(valor) &&
          valor.every(
            (codigo) =>
              typeof codigo === 'string' &&
              codigo.length === digitos &&
              /^\d+$/.test(codigo),
          ),
        defaultMessage: () => invalido,
      },
    }),
  );

/** Hasta diez años atrás: acota los filtros de días. */
export const MAXIMO_DIAS_SEGMENTO = 3650;
/** Géneros que puede nombrar un segmento (la cuenta lo escribe hasta en 30 caracteres). */
const MAXIMO_GENEROS = 10;

/** Número entero opcional entre `minimo` y `maximo`; `null` o sin enviar es «sin filtro». */
const EnteroOpcional = (etiqueta: string, minimo: number, maximo: number) =>
  applyDecorators(
    ValidateIf((_objeto, valor) => valor !== undefined && valor !== null),
    ValidateBy({
      name: 'enteroEnRango',
      validator: {
        validate: (valor: unknown) =>
          typeof valor === 'number' &&
          Number.isInteger(valor) &&
          valor >= minimo &&
          valor <= maximo,
        defaultMessage: () =>
          `${etiqueta} debe ser un número entero entre ${minimo.toLocaleString('es-CL')} y ${maximo.toLocaleString('es-CL')}.`,
      },
    }),
  );

const Dias = (etiqueta: string) =>
  EnteroOpcional(etiqueta, 1, MAXIMO_DIAS_SEGMENTO);

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

  // Filtros de cuenta (SCRUM-150): cada uno acota más; los suscriptores sin cuenta no los tienen

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 30,
    description: 'Con un pedido pagado en los últimos N días.',
  })
  @Dias('Los días desde la última compra')
  compraEnUltimosDias?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 90,
    description:
      'Compró alguna vez, pero su último pedido pagado es de hace más de N días (para reactivar).',
  })
  @Dias('Los días sin comprar')
  sinComprarHaceDias?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Mínimo de pedidos pagados.',
  })
  @EnteroOpcional('El mínimo de pedidos', 0, 10_000)
  pedidosMinimo?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Máximo de pedidos pagados (0: nunca compró).',
  })
  @EnteroOpcional('El máximo de pedidos', 0, 10_000)
  pedidosMaximo?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Mínimo gastado en pedidos pagados, en pesos con IVA.',
  })
  @EnteroOpcional('El gasto mínimo', 0, 1_000_000_000)
  gastoMinimo?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Máximo gastado en pedidos pagados, en pesos con IVA.',
  })
  @EnteroOpcional('El gasto máximo', 0, 1_000_000_000)
  gastoMaximo?: number | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['13'],
    maxItems: MAXIMO_FILTROS_SEGMENTO,
    description:
      'Código CUT de regiones: cuentas con alguna dirección guardada en una de ellas o en las comunas indicadas.',
  })
  @ListaDeCodigos('Las regiones', 2, 'Alguna región indicada no es válida.')
  regiones?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['13101'],
    maxItems: MAXIMO_FILTROS_SEGMENTO,
    description:
      'Código CUT de comunas: cuentas con alguna dirección guardada en una de ellas o en las regiones indicadas.',
  })
  @ListaDeCodigos('Las comunas', 5, 'Alguna comuna indicada no es válida.')
  comunas?: string[];

  @ApiPropertyOptional({
    type: [Number],
    example: [11, 12],
    description: 'Mes de cumpleaños (1 a 12).',
  })
  @ValidateIf((_objeto, valor) => valor !== undefined)
  @ValidateBy({
    name: 'mesesCumpleanos',
    validator: {
      validate: (valor: unknown) =>
        Array.isArray(valor) &&
        valor.length <= 24 &&
        valor.every(
          (mes) =>
            typeof mes === 'number' &&
            Number.isInteger(mes) &&
            mes >= 1 &&
            mes <= 12,
        ),
      defaultMessage: () =>
        'Los meses de cumpleaños deben ser números del 1 al 12.',
    },
  })
  mesesCumpleanos?: number[];

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Edad mínima en años cumplidos (sin fecha de nacimiento no entra).',
  })
  @EnteroOpcional('La edad mínima', 0, 120)
  edadMinima?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Edad máxima en años cumplidos (sin fecha de nacimiento no entra).',
  })
  @EnteroOpcional('La edad máxima', 0, 120)
  edadMaxima?: number | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['Femenino'],
    maxItems: MAXIMO_GENEROS,
    description: 'Género que escribió la cuenta, tal cual.',
  })
  @ValidateIf((_objeto, valor) => valor !== undefined)
  @ValidateBy({
    name: 'generos',
    validator: {
      validate: (valor: unknown) =>
        Array.isArray(valor) &&
        valor.length <= MAXIMO_GENEROS &&
        valor.every(
          (genero) =>
            typeof genero === 'string' &&
            genero.trim().length > 0 &&
            genero.length <= 30,
        ),
      defaultMessage: () =>
        `Indica hasta ${MAXIMO_GENEROS} géneros, de hasta 30 caracteres.`,
    },
  })
  generos?: string[];

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Cuenta creada en los últimos N días.',
  })
  @Dias('Los días desde que se creó la cuenta')
  registroUltimosDias?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Cuenta creada hace más de N días.',
  })
  @Dias('Los días de antigüedad de la cuenta')
  registroHaceMasDias?: number | null;

  @ApiPropertyOptional({
    description: 'Solo cuentas con productos en el carrito, aún sin comprar.',
  })
  @Booleano({ etiqueta: 'Con productos en el carrito' })
  conCarrito?: boolean;
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
