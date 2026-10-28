import { Module } from '@nestjs/common';
import { CarritoController } from './carrito.controller.js';
import { CarritoService } from './carrito.service.js';

/** Épica 5: carrito de compra (ver src/modulos/README.md). */
@Module({
  controllers: [CarritoController],
  providers: [CarritoService],
})
export class CarritoModule {}
