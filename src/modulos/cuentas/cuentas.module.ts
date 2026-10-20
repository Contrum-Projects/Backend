import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { COLAS } from '../../colas/colas.js';
import { CuentasController } from './cuentas.controller.js';
import { CuentasService } from './cuentas.service.js';
import { DireccionesController } from './direcciones.controller.js';
import { DireccionesService } from './direcciones.service.js';
import { IntentosSesion } from './intentos-sesion.js';
import { MiCuentaController } from './mi-cuenta.controller.js';
import { MiCuentaService } from './mi-cuenta.service.js';
import { SesionController } from './sesion.controller.js';
import { SesionService } from './sesion.service.js';

/** Épica 1: cuentas y acceso (ver src/modulos/README.md). */
@Module({
  imports: [BullModule.registerQueue({ name: COLAS.CORREOS })],
  controllers: [
    CuentasController,
    SesionController,
    MiCuentaController,
    DireccionesController,
  ],
  providers: [
    CuentasService,
    SesionService,
    IntentosSesion,
    MiCuentaService,
    DireccionesService,
  ],
})
export class CuentasModule {}
