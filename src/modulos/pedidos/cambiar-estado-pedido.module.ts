import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { COLAS } from '../../colas/colas.js';
import { CambiarEstadoPedidoController } from './cambiar-estado-pedido.controller.js';
import { CambiarEstadoPedidoService } from './cambiar-estado-pedido.service.js';

/** Épica 8: cambio de estado de los pedidos por el personal (ver src/modulos/README.md). */
@Module({
  imports: [BullModule.registerQueue({ name: COLAS.CORREOS })],
  controllers: [CambiarEstadoPedidoController],
  providers: [CambiarEstadoPedidoService],
  exports: [CambiarEstadoPedidoService],
})
export class CambiarEstadoPedidoModule {}
