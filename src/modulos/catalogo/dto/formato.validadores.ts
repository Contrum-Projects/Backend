import { ValidateBy, type ValidationArguments } from 'class-validator';
import {
  type Presencia,
  recortarTexto,
  segunPresencia,
} from '../../../common/validacion/presencia.js';

/**
 * Validadores propios de un formato de venta (E3-H2). Cada uno da un solo mensaje en español
 * que nombra el campo, para que el panel señale el dato erróneo. Los números y la fecha de
 * vencimiento usan los validadores comunes (`common/validacion`).
 */

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
