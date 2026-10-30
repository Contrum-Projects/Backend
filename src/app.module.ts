import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validarEntorno, type Entorno } from './config/entorno.js';
import { AutenticacionModule } from './autenticacion/autenticacion.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { LimitesModule } from './limites/limites.module.js';
import { CarritoModule } from './modulos/carrito/carrito.module.js';
import { CatalogoModule } from './modulos/catalogo/catalogo.module.js';
import { CuentasModule } from './modulos/cuentas/cuentas.module.js';
import { InventarioModule } from './modulos/inventario/inventario.module.js';
import { CancelarPedidoModule } from './modulos/pedidos/cancelar-pedido.module.js';
import { CrearPedidoModule } from './modulos/pedidos/crear-pedido.module.js';
import { MisPedidosModule } from './modulos/pedidos/mis-pedidos.module.js';
import { PagosModule } from './modulos/pagos/pagos.module.js';
import { PersonalModule } from './modulos/personal/personal.module.js';
import { TerritorioModule } from './modulos/territorio/territorio.module.js';
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
              'res.headers["set-cookie"]',
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
    AutenticacionModule,
    // Módulos de dominio: se agregan aquí a medida que se implementan las historias
    // (ver src/modulos/README.md).
    CuentasModule,
    PersonalModule,
    InventarioModule,
    CatalogoModule,
    CarritoModule,
    MisPedidosModule,
    CrearPedidoModule,
    CancelarPedidoModule,
    PagosModule,
    TerritorioModule,
  ],
  controllers: [SaludController],
})
export class AppModule {}
