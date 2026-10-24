import { Transform } from 'class-transformer';
import {
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';
import { applyDecorators } from '@nestjs/common';

interface Opciones {
  maximo: number;
  /** Cada palabra suma condiciones a la consulta: el tope acota su costo. */
  maximoPalabras?: number;
}

// PostgreSQL rechaza el byte nulo en un texto: sin esto la consulta respondería 500
// oxlint-disable-next-line no-control-regex
const CARACTER_CONTROL = /[\u0000-\u001f\u007f]/;

/** Mensaje del primer problema de la búsqueda, o `null` si es válida. */
const problemaBusqueda = (
  valor: unknown,
  { maximo, maximoPalabras }: Opciones,
): string | null => {
  if (typeof valor !== 'string' || CARACTER_CONTROL.test(valor)) {
    return 'La búsqueda no es válida.';
  }
  if (valor.length > maximo) {
    return `La búsqueda no puede superar los ${maximo} caracteres.`;
  }
  if (
    maximoPalabras !== undefined &&
    valor.split(/\s+/).filter(Boolean).length > maximoPalabras
  ) {
    return `La búsqueda admite hasta ${maximoPalabras} palabras.`;
  }
  return null;
};

/**
 * Texto de búsqueda opcional de un listado (`?buscar=`). Se recorta; vacío no filtra. Rechaza
 * caracteres de control y, si llega como arreglo (`?buscar=a&buscar=b`), responde 400. Los
 * comodines de ILIKE se escapan al consultar (`escaparComodines`).
 */
export function TextoBusqueda(opciones: Opciones) {
  return applyDecorators(
    ValidateIf((_objeto, valor) => valor !== undefined),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    ValidateBy({
      name: 'textoBusqueda',
      validator: {
        validate: (valor: unknown) =>
          problemaBusqueda(valor, opciones) === null,
        defaultMessage: ({ value }: ValidationArguments) =>
          problemaBusqueda(value, opciones) ?? '',
      },
    }),
  );
}

/**
 * Prisma no escapa los comodines de ILIKE en `contains`: sin esto, «%» o «_» coincidirían con
 * cualquier texto. Úsalo en cada `contains` que reciba texto del usuario.
 */
export const escaparComodines = (texto: string): string =>
  texto.replace(/[\\%_]/g, '\\$&');
