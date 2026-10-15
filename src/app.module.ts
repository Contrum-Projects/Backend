import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validarEntorno, type Entorno } from './config/entorno.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { LimitesModule } from './limites/limites.module.js';
import { CuentasModule } from './modulos/cuentas/cuentas.module.js';
import { SaludController } from './salud/salud.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validarEntorno,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Entorno, true>) => {
        const env = config.get('NODE_ENV', { infer: true });
        return {
          pinoHttp: {
            level: env === 'production' ? 'info' : 'debug',
            transport:
              env === 'development'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
            // Nunca registrar credenciales ni tokens (RNF-02, RNF-05)
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.contrasena',
              'req.body.password',
              'req.body.confirmacionContrasena',
              'req.body.token',
            ],
          },
        };
      },
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Entorno, true>) => ({
        connection: {
          url: config.get('REDIS_URL', { infer: true }),
          // Requerido por los workers de BullMQ
          maxRetriesPerRequest: null,
        },
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
        },
      }),
    }),
    PrismaModule,
    RedisModule,
    LimitesModule,
    // Módulos de dominio: se agregan aquí a medida que se implementan las historias
    // (ver src/modulos/README.md).
    CuentasModule,
  ],
  controllers: [SaludController],
})
export class AppModule {}
