import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { LIMITE_RECUPERACION_POR_CORREO } from '../../limites/limites.js';
import { REDIS } from '../../redis/redis.module.js';

/**
 * Suma la solicitud y fija la ventana en la primera, en un solo paso atómico.
 * KEYS[1] = correo; ARGV[1] = ventana (ms). Devuelve las solicitudes de la ventana.
 */
const SCRIPT_CONTAR = `
local total = redis.call('INCR', KEYS[1])
if total == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return total
`;

/** Con el prefijo de los límites, para que se limpien junto con ellos. */
const PREFIJO = 'limite:recuperacion-contrasena';

/**
 * Solicitudes de recuperación de la contraseña por correo (RNF-09, E1-H4), desde cualquier IP.
 * Cuenta todos los correos, tengan o no cuenta, para que el tope no revele cuáles están
 * registrados. El correo no queda en claro en Redis: se guarda su hash. Si Redis no responde,
 * no frena a nadie (RNF-32).
 */
@Injectable()
export class SolicitudesRecuperacion {
  private readonly logger = new Logger(SolicitudesRecuperacion.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Registra la solicitud. Devuelve falso si el correo ya llegó al tope de la ventana. */
  async reservar(email: string): Promise<boolean> {
    try {
      const total = (await this.redis.eval(
        SCRIPT_CONTAR,
        1,
        this.clave(email),
        LIMITE_RECUPERACION_POR_CORREO.ventanaMs,
      )) as number;
      return total <= LIMITE_RECUPERACION_POR_CORREO.maximo;
    } catch (error) {
      this.logger.warn(
        `No se pudo contar la solicitud de recuperación sin Redis: ${(error as Error).message}`,
      );
      return true;
    }
  }

  private clave(email: string): string {
    const correo = createHash('sha256').update(email).digest('hex');
    return `${PREFIJO}:${correo}`;
  }
}
