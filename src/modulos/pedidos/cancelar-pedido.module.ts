import { Module } from '@nestjs/common';
import { InventarioModule } from '../inventario/inventario.module.js';
import { CancelarPedidoController } from './cancelar-pedido.controller.js';
import { CancelarPedidoService } from './cancelar-pedido.service.js';

/** Épica 8: cancelación de pedidos por el personal (ver src/modulos/README.md). */
@Module({
  imports: [InventarioModule],
  controllers: [CancelarPedidoController],
  providers: [CancelarPedidoService],
})
export class CancelarPedidoModule {}
