import { Module } from '@nestjs/common';
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
import { TransferenciasController } from './transferencias.controller.js';
import { TransferenciasService } from './transferencias.service.js';

/** Épica 11: inventario y bodega (ver src/modulos/README.md). */
@Module({
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
  ],
})
export class InventarioModule {}
