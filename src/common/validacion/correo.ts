import { Transform } from 'class-transformer';
import { isEmail, ValidateBy, type ValidationArguments } from 'class-validator';
import { type Presencia, segunPresencia } from './presencia.js';

/** Largo máximo de una dirección de correo (RFC 5321). */
export const MAXIMO_CORREO = 254;

/**
 * Correo electrónico: se recorta y se guarda en minúsculas (E1: «correo en minúsculas»), así
 * `Camila@Correo.cl` y `camila@correo.cl` son la misma cuenta.
 */
export function Correo({ presencia = 'obligatorio' }: Presencia = {}) {
  return segunPresencia(presencia, [
    Transform(({ value }: { value: unknown }) => {
      if (typeof value !== 'string') return value;
      const correo = value.trim().toLowerCase();
      return presencia === 'borrable' && correo === '' ? null : correo;
    }),
    ValidateBy({
      name: 'correo',
      validator: {
        validate: (valor: unknown) =>
          typeof valor === 'string' &&
          valor.length <= MAXIMO_CORREO &&
          isEmail(valor),
        defaultMessage: ({ value }: ValidationArguments) =>
          value === undefined || value === null || value === ''
            ? 'El correo es obligatorio.'
            : 'El correo no es válido.',
      },
    }),
  ]);
}
