import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/**
 * Mensajes de los errores de validación, en el mismo orden y formato que da Nest (`message` es
 * una lista). Cada DTO trae sus propios mensajes en español; class-validator solo agrega uno
 * en inglés, el del campo que no está en el DTO (`forbidNonWhitelisted`), y ese se traduce aquí.
 */
export const mensajesValidacion = (
  errores: ValidationError[],
  ruta = '',
): string[] =>
  errores.flatMap((error) => {
    const campo = ruta ? `${ruta}.${error.property}` : error.property;
    const propios = Object.entries(error.constraints ?? {}).map(
      ([regla, mensaje]) =>
        regla === 'whitelistValidation'
          ? `El campo «${campo}» no se admite.`
          : mensaje,
    );
    return [...propios, ...mensajesValidacion(error.children ?? [], campo)];
  });

/** `exceptionFactory` del `ValidationPipe` global: 400 con los mensajes en español. */
export const errorValidacion = (errores: ValidationError[]) =>
  new BadRequestException(mensajesValidacion(errores));
