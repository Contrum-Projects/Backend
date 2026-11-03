import { Module } from '@nestjs/common';
import { InventarioModule } from '../inventario/inventario.module.js';
import { ReporteStockBajoController } from './reporte-stock-bajo.controller.js';

/** Épica 14: indicadores y reportes del panel (ver src/modulos/README.md). */
@Module({
  imports: [InventarioModule],
  controllers: [ReporteStockBajoController],
})
export class ReportesModule {}
