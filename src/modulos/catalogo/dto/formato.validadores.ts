import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';
import { MAXIMO_INT4 } from '../../../common/validacion/enteros.js';

/**
 * Validadores de los datos de un formato de venta (E3-H2). Cada uno da un solo mensaje en
 * español que nombra el campo, para que el panel señale el dato erróneo.
 */

interface Presencia {
  /**
   * `obligatorio`: debe venir. `puedeFaltar`: en una edición puede no venir, pero si viene no
   * puede ser `null`. `borrable`: puede no venir y `null` (o un texto vacío) borra el dato.
   */
  presencia?: 'obligatorio' | 'puedeFaltar' | 'borrable';
}

const segunPresencia = (
  presencia: Presencia['presencia'],
  decoradores: PropertyDecorator[],
) => {
  if (presencia === 'puedeFaltar') {
    decoradores.unshift(ValidateIf((_objeto, valor) => valor !== undefined));
  }
  if (presencia === 'borrable') {
    decoradores.unshift(
      ValidateIf((_objeto, valor) => valor !== undefined && valor !== null),
    );
  }
  return applyDecorators(...decoradores);
};

/** Recorta el texto; en un dato borrable, el texto vacío equivale a `null`. */
const recortarTexto = (borrable: boolean) =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const recortado = value.trim();
    return borrable && recortado === '' ? null : recortado;
  });

/** SKU: hasta 50 caracteres ASCII visibles, sin espacios. Único entre todos los artículos. */
export function Sku({ presencia = 'obligatorio' }: Presencia = {}) {
  return segunPresencia(presencia, [
    recortarTexto(false),
    ValidateBy({
      name: 'sku',
      validator: {
        validate: (valor: unknown) =>
          // Solo ASCII visible: un carácter invisible (U+200B) daría dos SKU que se ven iguales
          typeof valor === 'string' && /^[\x21-\x7E]{1,50}$/.test(valor),
        defaultMessage: (argumentos?: ValidationArguments) =>
          typeof argumentos?.value !== 'string' || argumentos.value === ''
            ? 'El SKU es obligatorio.'
            : 'El SKU debe tener hasta 50 caracteres, sin espacios, tildes ni símbolos especiales.',
      },
    }),
  ]);
}

/**
 * Código de barras opcional: solo dígitos, de 8, 12, 13 o 14 (EAN-8, UPC-A, EAN-13, GTIN-14),
 * sin revisar el dígito verificador (decisión del 24 de octubre de 2026).
 */
export function CodigoBarras() {
  return segunPresencia('borrable', [
    recortarTexto(true),
    ValidateBy({
      name: 'codigoBarras',
      validator: {
        validate: (valor: unknown) =>
          typeof valor === 'string' && /^(\d{8}|\d{12,14})$/.test(valor),
        defaultMessage: () =>
          'El código de barras debe tener 8, 12, 13 o 14 dígitos.',
      },
    }),
  ]);
}

interface OpcionesNumero extends Presencia {
  /** Cómo se nombra el dato en el mensaje: «El peso». */
  etiqueta: string;
  /** El valor puede ser 0 (el stock mínimo); si no, debe ser mayor que 0. */
  admiteCero?: boolean;
  /** Admite hasta dos decimales (columnas `Decimal(_, 2)`); si no, debe ser entero. */
  decimales?: boolean;
  /** Máximo que cabe en la columna. */
  maximo?: number;
}

/** Número positivo (o cero) que cabe en su columna, entero o con hasta dos decimales. */
export function NumeroPositivo({
  etiqueta,
  admiteCero,
  decimales,
  maximo = MAXIMO_INT4,
  presencia = 'obligatorio',
}: OpcionesNumero) {
  const formato = decimales ? /^\d+(\.\d{1,2})?$/ : /^\d+$/;
  return segunPresencia(presencia, [
    ValidateBy({
      name: 'numeroPositivo',
      validator: {
        validate: (valor: unknown) =>
          typeof valor === 'number' &&
          Number.isFinite(valor) &&
          formato.test(String(valor)) &&
          (admiteCero ? valor >= 0 : valor > 0) &&
          valor <= maximo,
        defaultMessage: (argumentos?: ValidationArguments) => {
          if (argumentos?.value === undefined || argumentos.value === null) {
            return `${etiqueta} es obligatorio.`;
          }
          const tipo = decimales
            ? 'un número con hasta dos decimales'
            : 'un número entero';
          const desde = admiteCero ? 'desde 0' : 'mayor que 0';
          return `${etiqueta} debe ser ${tipo} ${desde} y hasta ${maximo}.`;
        },
      },
    }),
  ]);
}

/** Fecha sin hora (AAAA-MM-DD) que existe en el calendario; `null` o vacío la borra. */
export function FechaSinHora({ etiqueta }: { etiqueta: string }) {
  return segunPresencia('borrable', [
    recortarTexto(true),
    ValidateBy({
      name: 'fechaSinHora',
      validator: {
        validate: (valor: unknown) => {
          if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
            return false;
          }
          const fecha = new Date(`${valor}T00:00:00Z`);
          return (
            !Number.isNaN(fecha.getTime()) &&
            fecha.toISOString().slice(0, 10) === valor
          );
        },
        defaultMessage: () =>
          `${etiqueta} debe ser una fecha válida con el formato AAAA-MM-DD.`,
      },
    }),
  ]);
}
