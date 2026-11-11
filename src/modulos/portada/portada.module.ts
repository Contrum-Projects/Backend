import { Module } from '@nestjs/common';
import { AlmacenModule } from '../../almacen/almacen.module.js';
import { DestinosPortada } from './destinos-portada.js';
import {
  PortadaPanelController,
  PortadaTiendaController,
} from './portada.controller.js';
import { PortadaService } from './portada.service.js';

/** Portada del inicio de la tienda (SCRUM-157, ver src/modulos/README.md). */
@Module({
  imports: [AlmacenModule],
  controllers: [PortadaTiendaController, PortadaPanelController],
  providers: [PortadaService, DestinosPortada],
})
export class PortadaModule {}
