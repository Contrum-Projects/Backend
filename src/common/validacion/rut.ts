import { Transform } from 'class-transformer';
import { ValidateBy, type ValidationArguments } from 'class-validator';
import { normalizarRut } from '../dominio/rut.js';
import { type Presencia, segunPresencia } from './presencia.js';

/**
 * RUT chileno con o sin puntos y guion. Llega al servicio en el formato único `12345678-K`
 * (`normalizarRut`); un RUT con el dígito verificador incorrecto se rechaza.
 */
export function Rut({ presencia = 'obligatorio' }: Presencia = {}) {
  return segunPresencia(presencia, [
    Transform(({ value }: { value: unknown }) => {
      if (typeof value !== 'string') return value;
      const recortado = value.trim();
      if (presencia === 'borrable' && recortado === '') return null;
      return normalizarRut(recortado) ?? recortado;
    }),
    ValidateBy({
      name: 'rut',
      validator: {
        validate: (valor: unknown) =>
          typeof valor === 'string' && normalizarRut(valor) === valor,
        defaultMessage: ({ value }: ValidationArguments) =>
          value === undefined || value === null || value === ''
            ? 'El RUT es obligatorio.'
            : 'El RUT no es válido.',
      },
    }),
  ]);
}
