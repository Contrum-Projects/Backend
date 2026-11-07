import { Module } from '@nestjs/common';
import { GestionFacturasController } from './gestion-facturas.controller.js';
import { GestionFacturasService } from './gestion-facturas.service.js';

/** Épica 9: lista de facturas del panel y datos para emitirlas (SCRUM-150; ver src/modulos/README.md). */
@Module({
  controllers: [GestionFacturasController],
  providers: [GestionFacturasService],
})
export class GestionFacturasModule {}
