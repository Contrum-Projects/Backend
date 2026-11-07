import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import type { CuerpoError, ErrorDeCampo } from '../errores/error-de-campo.js';

/**
 * Errores de validación con el campo al que pertenecen (SCRUM-150), en el mismo orden que da Nest.
 * `campo` es la ruta de la propiedad (`oferta.texto`, `detalles.0.cantidad`). Cada DTO trae sus
 * propios mensajes en español; class-validator solo agrega uno en inglés, el del campo que no está
 * en el DTO (`forbidNonWhitelisted`), y ese se traduce aquí.
 */
export const erroresValidacion = (
  errores: ValidationError[],
  ruta = '',
): ErrorDeCampo[] =>
  errores.flatMap((error) => {
    const campo = ruta ? `${ruta}.${error.property}` : error.property;
    const propios = Object.entries(error.constraints ?? {}).map(
      ([regla, mensaje]) => ({
        campo,
        mensaje:
          regla === 'whitelistValidation'
            ? `El campo «${campo}» no se admite.`
            : mensaje,
      }),
    );
    return [...propios, ...erroresValidacion(error.children ?? [], campo)];
  });

/** Mensajes de los errores de validación, en el mismo orden y formato que da Nest (una lista). */
export const mensajesValidacion = (errores: ValidationError[]): string[] =>
  erroresValidacion(errores).map(({ mensaje }) => mensaje);

/**
 * `exceptionFactory` del `ValidationPipe` global: 400 con los mensajes en español en `message`
 * (como siempre) y, desde SCRUM-150, `errores` con el campo de cada uno.
 */
export const errorValidacion = (errores: ValidationError[]) => {
  const conCampo = erroresValidacion(errores);
  const cuerpo: CuerpoError = {
    statusCode: 400,
    message: conCampo.map(({ mensaje }) => mensaje),
    error: 'Bad Request',
    errores: conCampo,
  };
  return new BadRequestException(cuerpo);
};
