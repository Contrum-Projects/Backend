import { Transform } from 'class-transformer';
import { ValidateBy } from 'class-validator';
import { type Presencia, segunPresencia } from './presencia.js';

interface Opciones extends Presencia {
  /** Cómo se nombra el dato en el mensaje: «Dejarla como principal». */
  etiqueta: string;
  /** Llega en la URL (`?incluirInactivos=true`): acepta los textos `true` y `false`. */
  desdeTexto?: boolean;
}

/** Sí o no; si llega, debe ser `true` o `false`. Por omisión puede faltar. */
export function Booleano({
  etiqueta,
  desdeTexto,
  presencia = 'puedeFaltar',
}: Opciones) {
  const decoradores: PropertyDecorator[] = [
    ValidateBy({
      name: 'booleano',
      validator: {
        validate: (valor: unknown) => typeof valor === 'boolean',
        defaultMessage: () => `${etiqueta} debe ser verdadero o falso.`,
      },
    }),
  ];
  if (desdeTexto) {
    decoradores.unshift(
      Transform(({ value }: { value: unknown }) => {
        if (value === 'true') return true;
        if (value === 'false') return false;
        return value;
      }),
    );
  }
  return segunPresencia(presencia, decoradores);
}
