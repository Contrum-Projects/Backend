import { applyDecorators } from '@nestjs/common';
import {
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';
import { MAXIMO_INT4 } from './enteros.js';

interface Opciones {
  /** Mensaje cuando el dato no llega: «La categoría del producto es obligatoria.» */
  faltante: string;
  /** Mensaje cuando llega algo que no es un id posible: «La categoría indicada no es válida.» */
  invalido: string;
  /** El campo puede no venir (en una edición, o un filtro). Si viene, debe ser válido. */
  opcional?: boolean;
  /** Además puede ser `null` (por ejemplo, quitar la categoría padre). */
  anulable?: boolean;
  /** Valida cada elemento de una lista de ids. */
  each?: boolean;
}

/**
 * Id de otra tabla: entero positivo que cabe en la columna (int4). Da un solo mensaje en
 * español, así el panel puede señalar el campo sin textos en inglés.
 */
export function IdEntero({
  faltante,
  invalido,
  opcional,
  anulable,
  each,
}: Opciones) {
  const decoradores = [
    ValidateBy(
      {
        name: 'idEntero',
        validator: {
          validate: (valor: unknown) =>
            Number.isInteger(valor) &&
            (valor as number) >= 1 &&
            (valor as number) <= MAXIMO_INT4,
          defaultMessage: (argumentos?: ValidationArguments) =>
            argumentos?.value === undefined || argumentos.value === null
              ? faltante
              : invalido,
        },
      },
      { each },
    ),
  ];
  if (opcional || anulable) {
    decoradores.unshift(
      ValidateIf(
        (_objeto, valor) =>
          valor !== undefined && !(anulable && valor === null),
      ),
    );
  }
  return applyDecorators(...decoradores);
}
