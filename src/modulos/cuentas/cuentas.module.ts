import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { COLAS } from '../../colas/colas.js';
import { CuentasController } from './cuentas.controller.js';
import { CuentasService } from './cuentas.service.js';
import { IntentosSesion } from './intentos-sesion.js';
import { SesionController } from './sesion.controller.js';
import { SesionService } from './sesion.service.js';

/** Épica 1: cuentas y acceso (ver src/modulos/README.md). */
@Module({
  imports: [BullModule.registerQueue({ name: COLAS.CORREOS })],
  controllers: [CuentasController, SesionController],
  providers: [CuentasService, SesionService, IntentosSesion],
})
export class CuentasModule {}
