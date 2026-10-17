import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { LIMITE_INICIO_SESION } from '../../limites/limites.js';
import { REDIS } from '../../redis/redis.module.js';

/**
 * Consulta y reserva en un solo paso atómico, para que intentos simultáneos no
 * pasen el límite. KEYS[1] = correo + IP, KEYS[2] = IP; ARGV = ventana (ms),
 * máximo por correo, máximo por IP. Devuelve los ms de bloqueo (0 = reservado).
 * La ventana corre desde el primer intento.
 */
const SCRIPT_RESERVAR = `
local espera = 0
if tonumber(redis.call('GET', KEYS[1]) or '0') >= tonumber(ARGV[2]) then
  espera = redis.call('PTTL', KEYS[1])
end
if tonumber(redis.call('GET', KEYS[2]) or '0') >= tonumber(ARGV[3]) then
  espera = math.max(espera, redis.call('PTTL', KEYS[2]))
end
if espera > 0 then return espera end
for _, clave in ipairs(KEYS) do
  if redis.call('INCR', clave) == 1 then redis.call('PEXPIRE', clave, ARGV[1]) end
end
return 0
`;

/**
 * Devuelve un intento reservado. ARGV[1] = '1' borra el contador del correo (inicio
 * correcto); si no, lo descuenta. El de la IP siempre se descuenta, sin bajar de 0.
 */
const SCRIPT_DEVOLVER = `
if ARGV[1] == '1' then
  redis.call('DEL', KEYS[1])
elseif tonumber(redis.call('GET', KEYS[1]) or '0') > 0 then
  redis.call('DECR', KEYS[1])
end
if tonumber(redis.call('GET', KEYS[2]) or '0') > 0 then
  redis.call('DECR', KEYS[2])
end
return 1
`;

/** Con el prefijo de los límites, para que se limpien junto con ellos. */
const PREFIJO = 'limite:inicio-sesion';

/**
 * Intentos fallidos de inicio de sesión (RNF-09, E1-H2). Cuenta por correo + IP y,
 * como tope, por IP. Cada intento se reserva antes de verificar la contraseña y se
 * devuelve si no resultó fallido. El correo no queda en claro en Redis: se guarda
 * su hash. Si Redis no responde, no bloquea a nadie (RNF-32).
 */
@Injectable()
export class IntentosSesion {
  private readonly logger = new Logger(IntentosSesion.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Reserva un intento. Devuelve los segundos que faltan para poder intentar de
   * nuevo, o 0 si quedó reservado (o si Redis no respondió).
   */
  async reservar(email: string, ip: string): Promise<number> {
    try {
      const espera = (await this.redis.eval(
        SCRIPT_RESERVAR,
        2,
        ...this.claves(email, ip),
        LIMITE_INICIO_SESION.ventanaMs,
        LIMITE_INICIO_SESION.fallidosPorCorreo,
        LIMITE_INICIO_SESION.fallidosPorIp,
      )) as number;
      return Math.max(0, Math.ceil(espera / 1000));
    } catch (error) {
      this.advertir('reservar', error);
      return 0;
    }
  }

  /** Inicio correcto: reinicia el contador del correo y devuelve el intento a la IP. */
  async confirmarExito(email: string, ip: string): Promise<void> {
    await this.devolver(email, ip, true);
  }

  /** El intento no fue fallido (contraseña correcta, cuenta que no puede entrar). */
  async descontar(email: string, ip: string): Promise<void> {
    await this.devolver(email, ip, false);
  }

  private async devolver(email: string, ip: string, exito: boolean) {
    try {
      await this.redis.eval(
        SCRIPT_DEVOLVER,
        2,
        ...this.claves(email, ip),
        exito ? '1' : '0',
      );
    } catch (error) {
      this.advertir('devolver', error);
    }
  }

  private claves(email: string, ip: string): [string, string] {
    const correo = createHash('sha256').update(email).digest('hex');
    return [`${PREFIJO}:${ip}:${correo}`, `${PREFIJO}:${ip}`];
  }

  private advertir(accion: string, error: unknown) {
    this.logger.warn(
      `No se pudo ${accion} el intento de inicio de sesión sin Redis: ${(error as Error).message}`,
    );
  }
}
