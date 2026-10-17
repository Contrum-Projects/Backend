import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { COLAS } from '../../colas/colas.js';
import type { Entorno } from '../../config/entorno.js';
import { CuentasController } from './cuentas.controller.js';
import { CuentasService } from './cuentas.service.js';
import { IntentosSesion } from './intentos-sesion.js';
import { SesionController } from './sesion.controller.js';
import { SesionService } from './sesion.service.js';

/** Épica 1: cuentas y acceso (ver src/modulos/README.md). */
@Module({
  imports: [
    BullModule.registerQueue({ name: COLAS.CORREOS }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Entorno, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
      }),
    }),
  ],
  controllers: [CuentasController, SesionController],
  providers: [CuentasService, SesionService, IntentosSesion],
})
export class CuentasModule {}
