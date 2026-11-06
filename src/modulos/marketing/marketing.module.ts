import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { COLAS } from '../../colas/colas.js';
import { CarritoModule } from '../carrito/carrito.module.js';
import { BajasController } from './bajas.controller.js';
import { CampanasController } from './campanas.controller.js';
import { CampanasService } from './campanas.service.js';
import { HuellaCampana } from './huella-campana.js';
import { BajasService } from './bajas.service.js';
import { CarritosAbandonadosProcessor } from './carritos-abandonados.processor.js';
import { CarritosAbandonadosService } from './carritos-abandonados.service.js';
import { ConsentimientoController } from './consentimiento.controller.js';
import { ConsentimientoService } from './consentimiento.service.js';
import { CumpleanosController } from './cumpleanos.controller.js';
import { CumpleanosService } from './cumpleanos.service.js';
import { FirmaBaja } from './firma-baja.js';
import { FirmaSeguimiento } from './firma-seguimiento.js';
import { FirmaSuscripcion } from './firma-suscripcion.js';
import { SaludosCumpleanosProcessor } from './saludos-cumpleanos.processor.js';
import { SaludosCumpleanosService } from './saludos-cumpleanos.service.js';
import { RebotesController } from './rebotes.controller.js';
import { RebotesService } from './rebotes.service.js';
import { SeguimientoController } from './seguimiento.controller.js';
import { SeguimientoService } from './seguimiento.service.js';
import { SuscripcionesController } from './suscripciones.controller.js';
import { SuscripcionesService } from './suscripciones.service.js';

/** Épica 12: marketing por correo (ver src/modulos/README.md). */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: COLAS.CORREOS },
      { name: COLAS.CARRITOS_ABANDONADOS },
      { name: COLAS.CUMPLEANOS },
    ),
    // Qué artículos del carrito siguen a la venta para la cuenta (E12-H4, RNF-04)
    CarritoModule,
  ],
  controllers: [
    SuscripcionesController,
    BajasController,
    ConsentimientoController,
    CampanasController,
    CumpleanosController,
    SeguimientoController,
    RebotesController,
  ],
  providers: [
    CampanasService,
    HuellaCampana,
    SuscripcionesService,
    BajasService,
    ConsentimientoService,
    FirmaSuscripcion,
    FirmaBaja,
    FirmaSeguimiento,
    SeguimientoService,
    RebotesService,
    CarritosAbandonadosService,
    CarritosAbandonadosProcessor,
    CumpleanosService,
    SaludosCumpleanosService,
    SaludosCumpleanosProcessor,
  ],
  exports: [FirmaSuscripcion, FirmaBaja, FirmaSeguimiento],
})
export class MarketingModule {}
