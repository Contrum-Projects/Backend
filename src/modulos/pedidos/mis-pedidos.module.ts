import { Module } from '@nestjs/common';
import { MisPedidosController } from './mis-pedidos.controller.js';
import { MisPedidosService } from './mis-pedidos.service.js';

/** Épica 8: pedidos de la cuenta (ver src/modulos/README.md). */
@Module({
  controllers: [MisPedidosController],
  providers: [MisPedidosService],
})
export class MisPedidosModule {}
