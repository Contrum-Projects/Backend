import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import {
  ALCANCES_CUPON,
  TIPOS_DESCUENTO_CUPON,
} from '../../../common/dominio/valores.js';
import { Booleano } from '../../../common/validacion/booleano.js';
import { MAXIMO_INT4 } from '../../../common/validacion/enteros.js';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

const TIPOS = Object.values(TIPOS_DESCUENTO_CUPON);
const ALCANCES = Object.values(ALCANCES_CUPON);

/** Artículos, categorías o marcas que puede nombrar un cupón. */
export const MAXIMO_ELEGIDOS_CUPON = 100;

/** Entero positivo opcional (pesos o usos); `null` o sin enviar es «sin límite». */
const PositivoOpcional = (etiqueta: string) =>
  applyDecorators(
    ValidateIf((_objeto, valor) => valor !== undefined && valor !== null),
    ValidateBy({
      name: 'positivoOpcional',
      validator: {
        validate: (valor: unknown) =>
          Number.isInteger(valor) &&
          (valor as number) >= 1 &&
          (valor as number) <= MAXIMO_INT4,
        defaultMessage: () =>
          `${etiqueta} debe ser un número entero mayor que 0.`,
      },
    }),
  );

/** Fecha y hora ISO 8601 opcional; `null` es «sin fecha». */
const FechaHoraOpcional = (etiqueta: string) =>
  applyDecorators(
    ValidateIf((_objeto, valor) => valor !== undefined && valor !== null),
    ValidateBy({
      name: 'fechaHoraOpcional',
      validator: {
        validate: (valor: unknown) =>
          typeof valor === 'string' &&
          /^\d{4}-\d{2}-\d{2}T/.test(valor) &&
          !Number.isNaN(Date.parse(valor)),
        defaultMessage: () =>
          `${etiqueta} debe ser una fecha y hora válida (ISO 8601).`,
      },
    }),
  );

const ListaDeIds = (etiqueta: string, invalido: string) =>
  applyDecorators(
    ValidateIf((_objeto, valor) => valor !== undefined),
    IsArray({ message: `${etiqueta} deben ser una lista.` }),
    ArrayMaxSize(MAXIMO_ELEGIDOS_CUPON, {
      message: `Indica hasta ${MAXIMO_ELEGIDOS_CUPON} ${etiqueta.toLowerCase()}.`,
    }),
    IdEntero({ faltante: invalido, invalido, each: true }),
  );

/**
 * Un cupón de descuento (SCRUM-150, decisiones del 7 nov). Las reglas que miran varios campos (el
 * porcentaje hasta 100, el tope solo con porcentaje, qué elegir según el alcance, que existan los
 * artículos, categorías, marcas y la campaña, y el orden de las fechas) las revisa el servicio.
 */
export class CrearCuponDto {
  @ApiProperty({
    example: 'LOREAL20',
    minLength: 3,
    maxLength: 30,
    description:
      'Letras, números y guiones; se guarda en mayúsculas. Es el que escribe el comprador.',
  })
  @TextoObligatorio({ etiqueta: 'El código del cupón', maximo: 30, minimo: 3 })
  @ValidateBy({
    name: 'codigoCupon',
    validator: {
      validate: (valor: unknown) =>
        typeof valor !== 'string' || /^[A-Za-z0-9-]+$/.test(valor),
      defaultMessage: () =>
        'El código del cupón solo puede tener letras, números y guiones, sin espacios.',
    },
  })
  codigo: string;

  @ApiPropertyOptional({
    example: "20 % en productos L'Oréal",
    maxLength: 200,
    nullable: true,
    description: 'Lo que verá el comprador al aplicarlo.',
  })
  @TextoOpcional({ etiqueta: 'La descripción del cupón', maximo: 200 })
  descripcion?: string | null;

  @ApiProperty({ enum: TIPOS, example: TIPOS_DESCUENTO_CUPON.PORCENTAJE })
  @IsIn(TIPOS, {
    message: `El tipo de descuento debe ser uno de estos: ${TIPOS.join(', ')}.`,
  })
  tipoDescuento: string;

  @ApiProperty({
    example: 20,
    description: 'Porcentaje (1 a 100) o monto en pesos con IVA.',
  })
  @PositivoOpcional('El valor del descuento')
  @ValidateBy({
    name: 'valorObligatorio',
    validator: {
      validate: (valor: unknown) => valor !== undefined && valor !== null,
      defaultMessage: () => 'El valor del descuento es obligatorio.',
    },
  })
  valor: number;

  @ApiPropertyOptional({
    example: 10000,
    nullable: true,
    description: 'Tope en pesos del descuento; solo con porcentaje.',
  })
  @PositivoOpcional('El tope del descuento')
  topeDescuento?: number | null;

  @ApiProperty({ enum: ALCANCES, example: ALCANCES_CUPON.CATEGORIAS_MARCAS })
  @IsIn(ALCANCES, {
    message: `El alcance del cupón debe ser uno de estos: ${ALCANCES.join(', ')}.`,
  })
  alcance: string;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Formatos o packs (ids de artículo); con alcance `articulos`.',
  })
  @ListaDeIds('Los artículos', 'Algún artículo indicado no es válido.')
  articulos?: number[];

  @ApiPropertyOptional({
    type: [Number],
    description:
      'Categorías (con sus subcategorías); con alcance `categorias_marcas`.',
  })
  @ListaDeIds('Las categorías', 'Alguna categoría indicada no es válida.')
  categorias?: number[];

  @ApiPropertyOptional({
    type: [Number],
    description: 'Marcas; con alcance `categorias_marcas`.',
  })
  @ListaDeIds('Las marcas', 'Alguna marca indicada no es válida.')
  marcas?: number[];

  @ApiPropertyOptional({
    example: 30000,
    nullable: true,
    description: 'Subtotal de productos con IVA mínimo para usarlo.',
  })
  @PositivoOpcional('La compra mínima')
  compraMinima?: number | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @FechaHoraOpcional('El inicio de la vigencia')
  fechaInicio?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @FechaHoraOpcional('El fin de la vigencia')
  fechaFin?: string | null;

  @ApiPropertyOptional({
    example: 100,
    nullable: true,
    description: 'Usos en total (pedidos no cancelados).',
  })
  @PositivoOpcional('El máximo de usos')
  usosMaximos?: number | null;

  @ApiPropertyOptional({
    example: 1,
    nullable: true,
    description: 'Usos por cuenta.',
  })
  @PositivoOpcional('Los usos por cuenta')
  usosPorCuenta?: number | null;

  @ApiPropertyOptional({
    description: 'También sobre el precio profesional (mayorista).',
  })
  @Booleano({ etiqueta: 'Aplicar al precio profesional' })
  incluyeProfesionales?: boolean;

  @ApiPropertyOptional({ description: 'Si se puede usar. Por omisión, sí.' })
  @Booleano({ etiqueta: 'Activo' })
  activo?: boolean;

  @ApiPropertyOptional({
    example: 12,
    nullable: true,
    description:
      'Campaña de envío único: solo lo usan las cuentas a las que se les envió.',
  })
  @IdEntero({
    faltante: 'La campaña indicada no es válida.',
    invalido: 'La campaña indicada no es válida.',
    opcional: true,
    anulable: true,
  })
  campanaId?: number | null;
}

/** Edición: cada campo que llega reemplaza al anterior; los demás no cambian. */
export class ActualizarCuponDto extends PartialType(CrearCuponDto) {}

/** Vista previa de un cupón sobre el carrito de la cuenta. */
export class ValidarCuponDto {
  @ApiProperty({ example: 'LOREAL20' })
  @TextoObligatorio({ etiqueta: 'El código del cupón', maximo: 40 })
  codigo: string;
}
