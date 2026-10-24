import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ValidateIf } from 'class-validator';

/**
 * Si un dato debe venir en el cuerpo. Todos los validadores de `common/validacion` la aceptan,
 * así cada campo da un solo mensaje en español que lo nombra.
 */
export interface Presencia {
  /**
   * `obligatorio`: debe venir. `puedeFaltar`: en una edición puede no venir, pero si viene no
   * puede ser `null`. `borrable`: puede no venir y `null` (o un texto vacío) borra el dato.
   */
  presencia?: 'obligatorio' | 'puedeFaltar' | 'borrable';
}

export const segunPresencia = (
  presencia: Presencia['presencia'],
  decoradores: PropertyDecorator[],
) => {
  if (presencia === 'puedeFaltar') {
    decoradores.unshift(ValidateIf((_objeto, valor) => valor !== undefined));
  }
  if (presencia === 'borrable') {
    decoradores.unshift(
      ValidateIf((_objeto, valor) => valor !== undefined && valor !== null),
    );
  }
  return applyDecorators(...decoradores);
};

/** Recorta el texto; en un dato borrable, el texto vacío equivale a `null`. */
export const recortarTexto = (borrable: boolean) =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const recortado = value.trim();
    return borrable && recortado === '' ? null : recortado;
  });
