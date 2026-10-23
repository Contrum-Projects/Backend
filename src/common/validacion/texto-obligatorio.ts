import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

interface Opciones {
  /** Cómo se nombra el dato en el mensaje: «El nombre del producto». */
  etiqueta: string;
  maximo: number;
  /** La etiqueta es femenina («La descripción»): el mensaje dice «obligatoria». */
  femenino?: boolean;
  /**
   * En una edición el campo puede faltar en el cuerpo (no se cambia), pero si llega
   * no puede ser `null` ni quedar vacío.
   */
  puedeFaltar?: boolean;
}

/**
 * Texto que se recorta y no puede quedar vacío ni pasar del máximo. Da un solo mensaje en
 * español por campo, que lo nombra: el panel lo usa para señalar lo que falta.
 */
export function TextoObligatorio({
  etiqueta,
  maximo,
  femenino,
  puedeFaltar,
}: Opciones) {
  const decoradores = [
    Transform(recortar),
    ValidateBy({
      name: 'textoObligatorio',
      validator: {
        validate: (valor: unknown) =>
          typeof valor === 'string' &&
          valor.length > 0 &&
          valor.length <= maximo,
        defaultMessage: ({ value }: ValidationArguments) =>
          typeof value === 'string' && value.length > maximo
            ? `${etiqueta} no puede superar los ${maximo} caracteres.`
            : `${etiqueta} es ${femenino ? 'obligatoria' : 'obligatorio'}.`,
      },
    }),
  ];
  if (puedeFaltar) {
    decoradores.unshift(ValidateIf((_objeto, valor) => valor !== undefined));
  }
  return applyDecorators(...decoradores);
}
