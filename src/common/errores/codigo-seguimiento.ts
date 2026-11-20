import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Código de seguimiento de cada petición (SCRUM-168): une lo que ve la persona («código
 * TY-…»), la línea del log y la fila de `registro_error`. Viaja en esta cabecera, de ida (el
 * proxy de Next lo genera) y de vuelta.
 */
export const CABECERA_SEGUIMIENTO = 'x-request-id';

/** Letras, dígitos y guiones: un UUID o algo parecido. Nada que pueda ensuciar el log. */
export const FORMATO_CODIGO_SEGUIMIENTO = /^[A-Za-z0-9-]{8,64}$/;

export const esCodigoSeguimiento = (valor: unknown): valor is string =>
  typeof valor === 'string' && FORMATO_CODIGO_SEGUIMIENTO.test(valor);

/** El código que pino-http dejó en `req.id`, o uno nuevo si no hay (no debería pasar). */
export const codigoDeLaPeticion = (peticion: { id?: unknown }): string =>
  esCodigoSeguimiento(peticion.id) ? peticion.id : randomUUID();

/**
 * `genReqId` de pino-http: usa el código que trae la petición si tiene el formato, o crea uno, y
 * lo devuelve en la respuesta. pino-http lo deja en `req.id` y en cada línea del log.
 */
export const asignarCodigoSeguimiento = (
  peticion: IncomingMessage,
  respuesta: ServerResponse,
): string => {
  const entrante = peticion.headers[CABECERA_SEGUIMIENTO];
  const codigo = esCodigoSeguimiento(entrante) ? entrante : randomUUID();
  respuesta.setHeader(CABECERA_SEGUIMIENTO, codigo);
  return codigo;
};
