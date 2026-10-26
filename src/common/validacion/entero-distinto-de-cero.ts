import { ValidateBy, type ValidationArguments } from 'class-validator';
import { MAXIMO_INT4 } from './enteros.js';

interface Opciones {
  /** Cómo se nombra el dato en el mensaje: «La cantidad». */
  etiqueta: string;
  /** La etiqueta es femenina («La cantidad»): el mensaje dice «obligatoria». */
  femenino?: boolean;
}

/**
 * Entero con signo y distinto de 0 que, sin el signo, cabe en una columna int4 (un ajuste de
 * stock: +3 suma, -2 descuenta). Da un solo mensaje en español que lo nombra.
 */
export function EnteroDistintoDeCero({ etiqueta, femenino }: Opciones) {
  return ValidateBy({
    name: 'enteroDistintoDeCero',
    validator: {
      validate: (valor: unknown) =>
        Number.isInteger(valor) &&
        valor !== 0 &&
        Math.abs(valor as number) <= MAXIMO_INT4,
      defaultMessage: ({ value }: ValidationArguments) =>
        value === undefined || value === null
          ? `${etiqueta} es ${femenino ? 'obligatoria' : 'obligatorio'}.`
          : `${etiqueta} debe ser un número entero distinto de 0, entre -${MAXIMO_INT4} y ${MAXIMO_INT4}.`,
    },
  });
}
