import { Module } from '@nestjs/common';
import { CarritoModule } from '../carrito/carrito.module.js';
import { DespachoModule } from '../despacho/despacho.module.js';
import { InventarioModule } from '../inventario/inventario.module.js';
import { CrearPedidoController } from './crear-pedido.controller.js';
import { CrearPedidoService } from './crear-pedido.service.js';
import { MisPedidosModule } from './mis-pedidos.module.js';

/** Épica 5: creación del pedido desde el carrito (ver src/modulos/README.md). */
@Module({
  imports: [CarritoModule, DespachoModule, InventarioModule, MisPedidosModule],
  controllers: [CrearPedidoController],
  providers: [CrearPedidoService],
})
export class CrearPedidoModule {}
