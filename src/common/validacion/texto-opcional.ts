import { ValidateBy, type ValidationArguments } from 'class-validator';
import { recortarTexto, segunPresencia } from './presencia.js';

interface Opciones {
  /** Cómo se nombra el dato en el mensaje: «El teléfono». */
  etiqueta: string;
  maximo: number;
}

/**
 * Texto opcional que se recorta y no pasa del máximo. Puede no venir; `null` o un texto vacío lo
 * dejan sin valor (en una edición, lo borran). Da un solo mensaje en español que lo nombra.
 */
export function TextoOpcional({ etiqueta, maximo }: Opciones) {
  return segunPresencia('borrable', [
    recortarTexto(true),
    ValidateBy({
      name: 'textoOpcional',
      validator: {
        validate: (valor: unknown) =>
          typeof valor === 'string' && valor.length <= maximo,
        defaultMessage: ({ value }: ValidationArguments) =>
          typeof value === 'string'
            ? `${etiqueta} no puede superar los ${maximo} caracteres.`
            : `${etiqueta} debe ser un texto.`,
      },
    }),
  ]);
}
