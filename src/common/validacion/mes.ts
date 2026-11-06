import { ValidateBy, type ValidationArguments } from 'class-validator';
import { type Presencia, recortarTexto, segunPresencia } from './presencia.js';

interface Opciones extends Presencia {
  /** Cómo se nombra el dato en el mensaje: «El mes desde». */
  etiqueta: string;
}

/**
 * Mes del calendario con el formato AAAA-MM (de 01 a 12), de los años 1900 a 2099: PostgreSQL no
 * acepta el año 0 y ningún dato de la tienda es anterior. Por defecto es borrable.
 */
export function Mes({ etiqueta, presencia = 'borrable' }: Opciones) {
  return segunPresencia(presencia, [
    recortarTexto(presencia === 'borrable'),
    ValidateBy({
      name: 'mes',
      validator: {
        validate: (valor: unknown) =>
          typeof valor === 'string' &&
          /^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(valor),
        defaultMessage: (argumentos?: ValidationArguments) =>
          argumentos?.value === undefined ||
          argumentos.value === null ||
          argumentos.value === ''
            ? `${etiqueta} es obligatorio.`
            : `${etiqueta} debe ser un mes válido con el formato AAAA-MM.`,
      },
    }),
  ]);
}
