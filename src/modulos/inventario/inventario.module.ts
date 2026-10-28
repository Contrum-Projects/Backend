import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { COLAS } from '../../colas/colas.js';
import { AjustesController } from './ajustes.controller.js';
import { AjustesService } from './ajustes.service.js';
import { EntradasController } from './entradas.controller.js';
import { EntradasService } from './entradas.service.js';
import { ProveedoresController } from './proveedores.controller.js';
import { ProveedoresService } from './proveedores.service.js';
import { SalidasController } from './salidas.controller.js';
import { SalidasService } from './salidas.service.js';
import { StockController } from './stock.controller.js';
import { StockService } from './stock.service.js';
import { StockBajoService } from './stock-bajo.service.js';
import { TransferenciasController } from './transferencias.controller.js';
import { TransferenciasService } from './transferencias.service.js';
import { VentaStockService } from './venta-stock.service.js';

/** Épica 11: inventario y bodega (ver src/modulos/README.md). */
@Module({
  imports: [BullModule.registerQueue({ name: COLAS.CORREOS })],
  controllers: [
    ProveedoresController,
    EntradasController,
    SalidasController,
    AjustesController,
    TransferenciasController,
    StockController,
  ],
  providers: [
    ProveedoresService,
    EntradasService,
    SalidasService,
    AjustesService,
    TransferenciasService,
    StockService,
    StockBajoService,
    VentaStockService,
  ],
  // El pedido (E5) y su cancelación (E6, E8) descuentan y reingresan stock con este servicio
  exports: [VentaStockService],
})
export class InventarioModule {}
