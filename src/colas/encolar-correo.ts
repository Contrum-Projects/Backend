import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PRIORIDAD_CORREO, type TrabajoCorreoConEnlace } from './colas.js';

/** Si Redis no responde en este plazo, la petición sigue sin esperar la cola. */
const ESPERA_MAXIMA_COLA_MS = 2_000;

/**
 * Encola un correo de cuenta con enlace de un uso, después del commit. Si Redis no
 * responde, la NOTIFICACION ya quedó pendiente en la base y la petición no falla
 * por eso (RNF-32): solo se advierte.
 */
export const encolarCorreoConEnlace = async (
  correos: Queue,
  trabajo: string,
  datos: TrabajoCorreoConEnlace,
  logger: Logger,
): Promise<void> => {
  let temporizador: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(
      () => rechazar(new Error('Redis no respondió a tiempo')),
      ESPERA_MAXIMA_COLA_MS,
    );
  });
  try {
    await Promise.race([
      correos.add(trabajo, datos, {
        priority: PRIORIDAD_CORREO.PEDIDO_Y_CUENTA,
        // El enlace lleva el token en claro: no queda guardado en Redis
        removeOnComplete: true,
        removeOnFail: true,
      }),
      limite,
    ]);
  } catch (error) {
    logger.warn(
      `No se pudo encolar el correo ${trabajo} (notificación ${datos.notificacionId}): ${(error as Error).message}`,
    );
  } finally {
    clearTimeout(temporizador);
  }
};
