import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PRIORIDAD_CORREO, type TrabajoCorreoConEnlace } from './colas.js';

/** Si Redis no responde en este plazo, la petición sigue sin esperar la cola. */
const ESPERA_MAXIMA_COLA_MS = 2_000;

// El estado del envío vive en NOTIFICACION: el trabajo se borra de Redis al terminar (bien o mal)
const OPCIONES_CORREO = {
  priority: PRIORIDAD_CORREO.PEDIDO_Y_CUENTA,
  removeOnComplete: true,
  removeOnFail: true,
} as const;

/** Espera una operación de la cola, con un único plazo: Redis caído no deja la petición colgada. */
export const conPlazoDeCola = async <T>(operacion: Promise<T>): Promise<T> => {
  let temporizador: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(
      () => rechazar(new Error('Redis no respondió a tiempo')),
      ESPERA_MAXIMA_COLA_MS,
    );
  });
  try {
    return await Promise.race([operacion, limite]);
  } finally {
    clearTimeout(temporizador);
  }
};

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
        ? correos.add(trabajo, lista[0], OPCIONES_CORREO)
        : correos.addBulk(
            lista.map((datos) => ({
              name: trabajo,
              data: datos,
              opts: OPCIONES_CORREO,
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
