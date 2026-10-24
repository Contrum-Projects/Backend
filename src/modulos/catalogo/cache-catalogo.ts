import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Entorno } from '../../config/entorno.js';
import { REDIS } from '../../redis/redis.module.js';

/**
 * Lo único del catálogo que puede ir a caché (RNF-30): el árbol de categorías y las marcas.
 * Nunca precios, stock ni datos de cuentas.
 */
export const CLAVES_CACHE = {
  CATEGORIAS: 'cache:tienda:categorias',
  MARCAS: 'cache:tienda:marcas',
} as const;

export type ClaveCache = (typeof CLAVES_CACHE)[keyof typeof CLAVES_CACHE];

/**
 * Caché del catálogo en Redis (E2-H1). Si Redis no responde, se lee de la base y la
 * tienda sigue funcionando (RNF-32). El panel la invalida después de cada cambio.
 */
@Injectable()
export class CacheCatalogo {
  private readonly logger = new Logger(CacheCatalogo.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService<Entorno, true>,
  ) {}

  /** Devuelve lo guardado en la clave o, si no está, lo carga de la base y lo guarda. */
  async obtener<T>(clave: ClaveCache, cargar: () => Promise<T>): Promise<T> {
    try {
      const guardado = await this.redis.get(clave);
      if (guardado !== null) {
        return JSON.parse(guardado) as T;
      }
    } catch (error) {
      this.advertir('leer', clave, error);
    }
    const valor = await cargar();
    try {
      await this.redis.set(
        clave,
        JSON.stringify(valor),
        'EX',
        this.config.get('CACHE_CATALOGO_SEGUNDOS', { infer: true }),
      );
    } catch (error) {
      this.advertir('guardar', clave, error);
    }
    return valor;
  }

  /**
   * Borra las claves para que la próxima lectura venga de la base. Se llama después del
   * commit; si Redis no responde, la copia vieja caduca sola con su vigencia.
   */
  async invalidar(...claves: ClaveCache[]): Promise<void> {
    try {
      await this.redis.del(...claves);
    } catch (error) {
      this.advertir('invalidar', claves.join(', '), error);
    }
  }

  private advertir(accion: string, clave: string, error: unknown) {
    this.logger.warn(
      `No se pudo ${accion} la caché ${clave} en Redis: ${(error as Error).message}`,
    );
  }
}
