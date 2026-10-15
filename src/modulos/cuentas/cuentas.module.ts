import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { COLAS } from '../../colas/colas.js';
import { CuentasController } from './cuentas.controller.js';
import { CuentasService } from './cuentas.service.js';

/** Épica 1: cuentas y acceso (ver src/modulos/README.md). */
@Module({
  imports: [BullModule.registerQueue({ name: COLAS.CORREOS })],
  controllers: [CuentasController],
  providers: [CuentasService],
})
export class CuentasModule {}
