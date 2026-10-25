import { Module } from '@nestjs/common';
import { EntradasController } from './entradas.controller.js';
import { EntradasService } from './entradas.service.js';
import { ProveedoresController } from './proveedores.controller.js';
import { ProveedoresService } from './proveedores.service.js';

/** Épica 11: inventario y bodega (ver src/modulos/README.md). */
@Module({
  controllers: [ProveedoresController, EntradasController],
  providers: [ProveedoresService, EntradasService],
})
export class InventarioModule {}
