import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

/**
 * Cuenta las peticiones y aplica el bloqueo en un solo paso atómico.
 * KEYS[1] = contador, KEYS[2] = bloqueo; ARGV = ventana (ms), límite, bloqueo (ms).
 * Devuelve { peticiones, ms para reiniciar el contador, ms de bloqueo restante }.
 */
const SCRIPT_CONTAR = `
local peticiones = redis.call('INCR', KEYS[1])
if peticiones == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local restante = redis.call('PTTL', KEYS[1])
local bloqueo = redis.call('PTTL', KEYS[2])
if bloqueo <= 0 and peticiones > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  bloqueo = tonumber(ARGV[3])
end
return { peticiones, restante, bloqueo }
`;

const PREFIJO = 'limite';

const aSegundos = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

/**
 * Almacenamiento de @nestjs/throttler en Redis (RNF-09): el contador es común a
 * todas las instancias del backend, sin estado en memoria (RNF-20).
 * Si Redis no responde, deja pasar la petición: la tienda no se cae por un
 * límite (RNF-32).
 */
export class AlmacenLimitesRedis implements ThrottlerStorage {
  private readonly logger = new Logger(AlmacenLimitesRedis.name);

  constructor(private readonly redis: Redis) {}

  async increment(
    clave: string,
    ttl: number,
    limite: number,
    duracionBloqueo: number,
    nombreLimite: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${PREFIJO}:${nombreLimite}:${clave}`;
    try {
      const [peticiones, restante, bloqueo] = (await this.redis.eval(
        SCRIPT_CONTAR,
        2,
        base,
        `${base}:bloqueo`,
        ttl,
        limite,
        duracionBloqueo > 0 ? duracionBloqueo : ttl,
      )) as [number, number, number];

      const bloqueado = bloqueo > 0;
      return {
        totalHits: peticiones,
        timeToExpire: aSegundos(restante),
        isBlocked: bloqueado,
        timeToBlockExpire: bloqueado ? aSegundos(bloqueo) : 0,
      };
    } catch (error) {
      this.logger.warn(
        `Límite de peticiones sin Redis, se deja pasar: ${(error as Error).message}`,
      );
      return {
        totalHits: 0,
        timeToExpire: aSegundos(ttl),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
