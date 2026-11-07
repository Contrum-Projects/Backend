import { Module } from '@nestjs/common';
import { CarritoModule } from '../carrito/carrito.module.js';
import { AplicarCuponService } from './aplicar-cupon.service.js';
import { CuponCarritoController } from './cupon-carrito.controller.js';
import { CuponCarritoService } from './cupon-carrito.service.js';
import { CuponesController } from './cupones.controller.js';
import { CuponesService } from './cupones.service.js';

/** Cupones de descuento (SCRUM-150): el panel los gestiona y el pedido los aplica. */
@Module({
  imports: [CarritoModule],
  controllers: [CuponesController, CuponCarritoController],
  providers: [AplicarCuponService, CuponCarritoService, CuponesService],
  exports: [AplicarCuponService],
})
export class CuponesModule {}
