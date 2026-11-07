import type { HttpException } from '@nestjs/common';

/**
 * Un error que pertenece a un campo de la entrada (decisión del 6 nov, SCRUM-150). `campo` es la
 * ruta de la propiedad en el cuerpo, con puntos e índices: `email`, `oferta.texto`,
 * `detalles.0.cantidad`. El frontend lo usa para mostrar el mensaje junto a ese campo, sin
 * adivinarlo por el texto.
 */
export interface ErrorDeCampo {
  campo: string;
  mensaje: string;
}

/**
 * Cuerpo de error de la API: el de Nest (`statusCode`, `message`, `error`) y, cuando el error es de
 * uno o más campos, `errores`. `message` no cambia: sigue siendo el texto (o la lista de textos de
 * la validación) que se muestra a la persona.
 */
export interface CuerpoError {
  statusCode: number;
  message: string | string[];
  error: string;
  errores?: ErrorDeCampo[];
}

type Excepcion<T extends HttpException> = new (
  cuerpo?: string | Record<string, unknown>,
) => T;

/**
 * La excepción de Nest de siempre, con `errores` para el o los campos a los que pertenece. Con
 * varios campos (p. ej. «El correo y el RUT ya están registrados») cada uno lleva el mismo mensaje.
 *
 * ```ts
 * throw errorDeCampo(ConflictException, 'Ya existe un proveedor con ese RUT.', 'rut');
 * ```
 */
export const errorDeCampo = <T extends HttpException>(
  Tipo: Excepcion<T>,
  mensaje: string,
  ...campos: [string, ...string[]]
): T => {
  const base = new Tipo(mensaje).getResponse() as CuerpoError;
  return new Tipo({
    ...base,
    errores: campos.map((campo) => ({ campo, mensaje })),
  });
};
