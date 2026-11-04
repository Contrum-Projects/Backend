import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { COLAS } from '../../colas/colas.js';
import { BajasController } from './bajas.controller.js';
import { BajasService } from './bajas.service.js';
import { ConsentimientoController } from './consentimiento.controller.js';
import { ConsentimientoService } from './consentimiento.service.js';
import { FirmaBaja } from './firma-baja.js';
import { FirmaSuscripcion } from './firma-suscripcion.js';
import { SuscripcionesController } from './suscripciones.controller.js';
import { SuscripcionesService } from './suscripciones.service.js';

/** Épica 12: marketing por correo (ver src/modulos/README.md). */
@Module({
  imports: [BullModule.registerQueue({ name: COLAS.CORREOS })],
  controllers: [
    SuscripcionesController,
    BajasController,
    ConsentimientoController,
  ],
  providers: [
    SuscripcionesService,
    BajasService,
    ConsentimientoService,
    FirmaSuscripcion,
    FirmaBaja,
  ],
  exports: [FirmaSuscripcion, FirmaBaja],
})
export class MarketingModule {}
