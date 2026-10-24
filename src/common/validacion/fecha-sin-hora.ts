import { ValidateBy } from 'class-validator';
import { recortarTexto, segunPresencia } from './presencia.js';

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
