import { ValidateBy, type ValidationArguments } from 'class-validator';
import { type Presencia, recortarTexto, segunPresencia } from './presencia.js';

interface Opciones extends Presencia {
  /** Cómo se nombra el dato en el mensaje: «La fecha de vencimiento». */
  etiqueta: string;
}

/**
 * Fecha sin hora (AAAA-MM-DD) que existe en el calendario. Por defecto es borrable: `null` o
 * vacío la borra.
 */
export function FechaSinHora({ etiqueta, presencia = 'borrable' }: Opciones) {
  return segunPresencia(presencia, [
    recortarTexto(presencia === 'borrable'),
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
        defaultMessage: (argumentos?: ValidationArguments) =>
          argumentos?.value === undefined ||
          argumentos.value === null ||
          argumentos.value === ''
            ? `${etiqueta} es obligatoria.`
            : `${etiqueta} debe ser una fecha válida con el formato AAAA-MM-DD.`,
      },
    }),
  ]);
}
