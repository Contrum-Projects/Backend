import { Module } from '@nestjs/common';
import { CarritoVisitanteController } from './carrito-visitante.controller.js';
import { CarritoController } from './carrito.controller.js';
import { CarritoService } from './carrito.service.js';

/** Épica 5: carrito de compra (ver src/modulos/README.md). */
@Module({
  controllers: [CarritoController, CarritoVisitanteController],
  providers: [CarritoService],
  exports: [CarritoService],
})
export class CarritoModule {}
