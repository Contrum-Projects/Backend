import { Module } from '@nestjs/common';
import { ProveedoresController } from './proveedores.controller.js';
import { ProveedoresService } from './proveedores.service.js';

/** Épica 11: inventario y bodega (ver src/modulos/README.md). */
@Module({
  controllers: [ProveedoresController],
  providers: [ProveedoresService],
  // Las entradas de inventario (E11-H2) comprueban que el proveedor existe
  exports: [ProveedoresService],
})
export class InventarioModule {}
