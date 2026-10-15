import { Global, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';
import { AlmacenLimitesRedis } from './almacen-limites-redis.js';

/**
 * Límites de peticiones (RNF-09). No hay guard global: cada ruta que lo necesita
 * declara su límite con `@UseGuards(ThrottlerGuard)` y `@Throttle(...)`
 * (ver `limites.ts`). Responde 429 al superarlo.
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis: Redis) => ({
        // Valor base; cada ruta lo reemplaza con su propio @Throttle
        throttlers: [{ name: 'default', ttl: 60_000, limit: 5 }],
        storage: new AlmacenLimitesRedis(redis),
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class LimitesModule {}
