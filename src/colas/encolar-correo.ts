import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PRIORIDAD_CORREO, type TrabajoCorreoConEnlace } from './colas.js';

/** Si Redis no responde en este plazo, la petición sigue sin esperar la cola. */
const ESPERA_MAXIMA_COLA_MS = 2_000;

/** Envíos que se prueban por trabajo antes de dejar la notificación `fallida` (E1-H6). */
export const INTENTOS_CORREO = 5;

// El estado del envío vive en NOTIFICACION: el trabajo se borra de Redis al terminar (bien o mal)
const OPCIONES_CORREO = {
  priority: PRIORIDAD_CORREO.PEDIDO_Y_CUENTA,
  attempts: INTENTOS_CORREO,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: true,
} as const;

/** Id del trabajo de una notificación: la revisión periódica lo busca para no duplicarlo. */
export const idTrabajoCorreo = (notificacionId: number): string =>
  `correo-${notificacionId}`;

/** Espera una operación, y falla con ese mensaje si no termina dentro del plazo. */
export const conPlazo = async <T>(
  operacion: Promise<T>,
  plazoMs: number,
  mensaje: string,
): Promise<T> => {
  let temporizador: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error(mensaje)), plazoMs);
  });
  try {
    return await Promise.race([operacion, limite]);
  } finally {
    clearTimeout(temporizador);
  }
};

/** Espera una operación de la cola, con un único plazo: Redis caído no deja la petición colgada. */
export const conPlazoDeCola = <T>(operacion: Promise<T>): Promise<T> =>
  conPlazo(operacion, ESPERA_MAXIMA_COLA_MS, 'Redis no respondió a tiempo');

const opcionesDe = ({ notificacionId }: { notificacionId: number }) => ({
  ...OPCIONES_CORREO,
  jobId: idTrabajoCorreo(notificacionId),
});

/**
 * Encola uno o varios correos de pedido o cuenta en una sola operación, después del commit. Si
 * Redis no responde, las NOTIFICACION ya quedaron pendientes en la base y la petición no falla
 * por eso (RNF-32): solo se advierte, tras un único plazo de espera.
 */
export const encolarCorreos = async <T extends { notificacionId: number }>(
  correos: Queue,
  trabajo: string,
  lista: T[],
  logger: Logger,
): Promise<void> => {
  if (lista.length === 0) return;
  try {
    await conPlazoDeCola<unknown>(
      lista.length === 1
        ? correos.add(trabajo, lista[0], opcionesDe(lista[0]))
        : correos.addBulk(
            lista.map((datos) => ({
              name: trabajo,
              data: datos,
              opts: opcionesDe(datos),
            })),
          ),
    );
  } catch (error) {
    const ids = lista.map((datos) => datos.notificacionId).join(', ');
    logger.warn(
      `No se pudo encolar el correo ${trabajo} (notificación ${ids}): ${(error as Error).message}`,
    );
  }
};

/**
 * Encola un correo de cuenta con enlace de un uso. El enlace lleva el token en claro:
 * por eso el trabajo no queda guardado en Redis al terminar.
 */
export const encolarCorreoConEnlace = (
  correos: Queue,
  trabajo: string,
  datos: TrabajoCorreoConEnlace,
  logger: Logger,
): Promise<void> => encolarCorreos(correos, trabajo, [datos], logger);
