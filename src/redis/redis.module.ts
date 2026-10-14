import {
  Global,
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Entorno } from '../config/entorno.js';

/** Token para inyectar el cliente: `@Inject(REDIS) private readonly redis: Redis`. */
export const REDIS = Symbol('REDIS');

/**
 * Cliente Redis para límites de peticiones, revocación de sesiones y caché.
 * Redis nunca guarda datos del negocio (RNF-29) y la venta no depende de él (RNF-32):
 * todo uso debe tolerar que Redis no responda.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<Entorno, true>) => {
        const logger = new Logger('Redis');
        const cliente = new Redis(config.get('REDIS_URL', { infer: true }), {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          // Falla al tiro si Redis no está, en vez de dejar la petición esperando
          enableOfflineQueue: false,
        });
        cliente.on('error', (e: Error) => logger.warn(e.message));
        // Espera el primer intento de conexión, pero la app arranca igual si
        // Redis no está: ioredis sigue reintentando en segundo plano (RNF-32).
        await cliente.connect().catch(() => undefined);
        return cliente;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy() {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
