import { Module } from '@nestjs/common';
import { GestionPedidosController } from './gestion-pedidos.controller.js';
import { GestionPedidosService } from './gestion-pedidos.service.js';
import { MisPedidosModule } from './mis-pedidos.module.js';
import { OrdenTransporteModule } from '../despacho/orden-transporte.module.js';

/** Épica 8: lista y detalle de pedidos del panel (SCRUM-150; ver src/modulos/README.md). */
@Module({
  imports: [MisPedidosModule, OrdenTransporteModule],
  controllers: [GestionPedidosController],
  providers: [GestionPedidosService],
})
export class GestionPedidosModule {}
