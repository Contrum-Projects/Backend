import { ValidateBy, type ValidationArguments } from 'class-validator';

/** Largo máximo de una contraseña: acota el costo de calcular su hash con argon2. */
export const MAXIMO_CONTRASENA = 128;
const MINIMO_CONTRASENA = 8;

/**
 * Contraseña nueva (registro E1-H1, invitación del personal E13-H1): 8 o más caracteres, con al
 * menos una letra y un número (decisión del 14 oct). No se recorta: un espacio es parte de ella.
 * Da un mensaje por regla incumplida.
 */
export function ContrasenaNueva() {
  return ValidateBy({
    name: 'contrasenaNueva',
    validator: {
      validate: (valor: unknown) => problemaContrasena(valor) === null,
      defaultMessage: ({ value }: ValidationArguments) =>
        problemaContrasena(value) ?? '',
    },
  });
}

const problemaContrasena = (valor: unknown): string | null => {
  if (typeof valor !== 'string' || valor === '') {
    return 'La contraseña es obligatoria.';
  }
  if (valor.length < MINIMO_CONTRASENA) {
    return `La contraseña debe tener al menos ${MINIMO_CONTRASENA} caracteres.`;
  }
  if (valor.length > MAXIMO_CONTRASENA) {
    return `La contraseña no puede superar los ${MAXIMO_CONTRASENA} caracteres.`;
  }
  if (!/\p{L}/u.test(valor)) {
    return 'La contraseña debe tener al menos una letra.';
  }
  if (!/\d/.test(valor)) {
    return 'La contraseña debe tener al menos un número.';
  }
  return null;
};

/**
 * Contraseña que se compara con otra ya guardada o escrita (inicio de sesión, confirmación): solo
 * se exige que llegue y no pase del máximo. No se recorta.
 */
export function ContrasenaIngresada({
  etiqueta = 'La contraseña',
}: { etiqueta?: string } = {}) {
  return ValidateBy({
    name: 'contrasenaIngresada',
    validator: {
      validate: (valor: unknown) =>
        typeof valor === 'string' &&
        valor.length > 0 &&
        valor.length <= MAXIMO_CONTRASENA,
      defaultMessage: ({ value }: ValidationArguments) =>
        typeof value === 'string' && value.length > MAXIMO_CONTRASENA
          ? `${etiqueta} no puede superar los ${MAXIMO_CONTRASENA} caracteres.`
          : `${etiqueta} es obligatoria.`,
    },
  });
}
