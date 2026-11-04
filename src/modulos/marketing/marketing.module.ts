import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { COLAS } from '../../colas/colas.js';
import { FirmaSuscripcion } from './firma-suscripcion.js';
import { SuscripcionesController } from './suscripciones.controller.js';
import { SuscripcionesService } from './suscripciones.service.js';

/** Épica 12: marketing por correo (ver src/modulos/README.md). */
@Module({
  imports: [BullModule.registerQueue({ name: COLAS.CORREOS })],
  controllers: [SuscripcionesController],
  providers: [SuscripcionesService, FirmaSuscripcion],
  exports: [FirmaSuscripcion],
})
export class MarketingModule {}
