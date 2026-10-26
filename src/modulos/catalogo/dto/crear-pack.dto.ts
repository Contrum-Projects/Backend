import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ValidateBy,
  ValidateIf,
  ValidateNested,
  type ValidationArguments,
} from 'class-validator';
import { CANALES_VENTA } from '../../../common/dominio/valores.js';
import { FechaSinHora } from '../../../common/validacion/fecha-sin-hora.js';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { NumeroPositivo } from '../../../common/validacion/numero-positivo.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { CanalVenta } from './canal-venta.decorator.js';
import { Sku } from './formato.validadores.js';

/** Unidades máximas de un formato dentro de un pack. */
export const MAXIMO_CANTIDAD_COMPONENTE = 99;
/** Formatos distintos que puede tener un pack: acota la consulta de disponibilidad (E2). */
export const MAXIMO_COMPONENTES_PACK = 20;
/** Un pack suma al menos estas unidades: un formato solo, una vez, no es una promoción. */
export const MINIMO_UNIDADES_PACK = 2;

/** Un formato del pack y cuántas unidades lleva. */
export class ComponentePackDto {
  @ApiProperty({
    example: 11,
    description: 'Id del formato de producto. Otro pack no se admite.',
  })
  @IdEntero({
    faltante: 'Indica el formato de cada componente del pack.',
    invalido: 'Algún formato indicado no es válido.',
  })
  formatoId: number;

  @ApiProperty({ example: 2, minimum: 1, maximum: MAXIMO_CANTIDAD_COMPONENTE })
  @NumeroPositivo({
    etiqueta: 'La cantidad del componente',
    femenino: true,
    maximo: MAXIMO_CANTIDAD_COMPONENTE,
  })
  cantidad: number;
}

const sumaUnidades = (lista: ComponentePackDto[]) =>
  lista.reduce(
    (suma, componente) =>
      suma +
      (Number.isInteger(componente.cantidad) && componente.cantidad > 0
        ? componente.cantidad
        : 0),
    0,
  );

/** Hay alguna cantidad inválida: su propio mensaje lo indica y no se revisa la suma. */
const hayCantidadInvalida = (lista: ComponentePackDto[]) =>
  lista.some(
    (componente) =>
      !Number.isInteger(componente.cantidad) || componente.cantidad <= 0,
  );

const repiteFormato = (lista: ComponentePackDto[]) => {
  const ids = lista
    .map((componente) => componente.formatoId)
    .filter((id) => id !== undefined);
  return new Set(ids).size !== ids.length;
};

/**
 * Componentes del pack (E3-H6): al menos uno, hasta `MAXIMO_COMPONENTES_PACK`, sin formatos
 * repetidos y sumando al menos `MINIMO_UNIDADES_PACK` unidades (un «3x2» de un mismo formato
 * sirve). Cada línea queda como `ComponentePackDto` y lo que no es lista como lista vacía, así
 * cada caso da un solo mensaje en español. Que cada id sea un formato (no un pack) lo revisa el
 * servicio contra la base.
 */
export function ListaComponentes({
  puedeFaltar,
}: { puedeFaltar?: boolean } = {}) {
  const comoComponente = (linea: unknown) =>
    linea instanceof ComponentePackDto
      ? linea
      : plainToInstance(
          ComponentePackDto,
          typeof linea === 'object' && linea !== null ? linea : {},
        );
  const decoradores = [
    // `undefined` se deja pasar: en la edición significa «no cambiar los componentes»
    Transform(({ value }: { value: unknown }) => {
      if (value === undefined) return undefined;
      return Array.isArray(value) ? value.map(comoComponente) : [];
    }),
    ValidateBy({
      name: 'listaComponentes',
      validator: {
        validate: (valor: unknown) => {
          if (!Array.isArray(valor) || valor.length === 0) return false;
          const lista = valor as ComponentePackDto[];
          return (
            lista.length <= MAXIMO_COMPONENTES_PACK &&
            !repiteFormato(lista) &&
            (hayCantidadInvalida(lista) ||
              sumaUnidades(lista) >= MINIMO_UNIDADES_PACK)
          );
        },
        defaultMessage: ({ value }: ValidationArguments) => {
          if (!Array.isArray(value) || value.length === 0) {
            return 'Indica los formatos del pack.';
          }
          const lista = value as ComponentePackDto[];
          if (lista.length > MAXIMO_COMPONENTES_PACK) {
            return `Un pack tiene hasta ${MAXIMO_COMPONENTES_PACK} formatos distintos.`;
          }
          return repiteFormato(lista)
            ? 'Cada formato debe aparecer una sola vez en el pack: indica su cantidad.'
            : `Un pack debe sumar al menos ${MINIMO_UNIDADES_PACK} unidades: agrega otro formato o aumenta la cantidad.`;
        },
      },
    }),
    ValidateNested({ each: true, message: 'Indica los formatos del pack.' }),
  ];
  if (puedeFaltar) {
    decoradores.unshift(ValidateIf((_objeto, valor) => valor !== undefined));
  }
  return applyDecorators(...decoradores);
}

/**
 * Entrada para crear un pack (E3-H6, RF-03.09): una promoción armada con formatos de producto y
 * sus cantidades. Nace activo y **sin precios** (los fija el administrador en E3-H5) y sin stock
 * propio: su disponibilidad sale de sus componentes. La vigencia es opcional; sin ella el pack
 * rige siempre.
 */
export class CrearPackDto {
  @ApiProperty({ example: 'PACK-REP-DUO', maxLength: 50 })
  @Sku()
  sku: string;

  @ApiProperty({ example: 'Dúo reparador', maxLength: 200 })
  @TextoObligatorio({ etiqueta: 'El nombre del pack', maximo: 200 })
  nombre: string;

  @ApiProperty({
    example: 'Shampoo y acondicionador reparador a precio de promoción.',
    maxLength: 5000,
  })
  @TextoObligatorio({
    etiqueta: 'La descripción del pack',
    maximo: 5000,
    femenino: true,
  })
  descripcion: string;

  @ApiProperty({
    enum: Object.values(CANALES_VENTA),
    example: CANALES_VENTA.GENERAL,
    description:
      'Canal de venta del pack. Un pack general no puede llevar formatos de productos exclusivos para profesionales.',
  })
  @CanalVenta()
  canalVenta: string;

  @ApiPropertyOptional({
    example: '2026-11-01',
    format: 'date',
    nullable: true,
    description:
      'Primer día en que el pack se muestra en la tienda (hora de Chile).',
  })
  @FechaSinHora({ etiqueta: 'La fecha de inicio de la vigencia' })
  fechaInicioVigencia?: string | null;

  @ApiPropertyOptional({
    example: '2026-11-30',
    format: 'date',
    nullable: true,
    description:
      'Último día en que el pack se muestra en la tienda (hora de Chile). No puede ser anterior al inicio.',
  })
  @FechaSinHora({ etiqueta: 'La fecha de término de la vigencia' })
  fechaFinVigencia?: string | null;

  @ApiProperty({
    type: [ComponentePackDto],
    description: `Formatos del pack con sus cantidades; cada formato una sola vez y al menos ${MINIMO_UNIDADES_PACK} unidades en total.`,
  })
  @Type(() => ComponentePackDto)
  @ListaComponentes()
  componentes: ComponentePackDto[];
}
