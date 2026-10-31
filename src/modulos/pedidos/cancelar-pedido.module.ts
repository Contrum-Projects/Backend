import { Module } from '@nestjs/common';
import { InventarioModule } from '../inventario/inventario.module.js';
import { CancelarPedidoController } from './cancelar-pedido.controller.js';
import { CancelarPedidoService } from './cancelar-pedido.service.js';

/**
 * Épica 8: cancelación de pedidos por el personal (ver src/modulos/README.md). Exporta el servicio
 * para la cancelación por impago (E6-H3).
 */
@Module({
  imports: [InventarioModule],
  controllers: [CancelarPedidoController],
  providers: [CancelarPedidoService],
  exports: [CancelarPedidoService],
})
export class CancelarPedidoModule {}
