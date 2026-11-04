import { Module } from '@nestjs/common';
import { InventarioModule } from '../inventario/inventario.module.js';
import { ReporteStockBajoController } from './reporte-stock-bajo.controller.js';
import { ReporteVentasController } from './reporte-ventas.controller.js';
import { ReporteVentasService } from './reporte-ventas.service.js';

/** Épica 14: indicadores y reportes del panel (ver src/modulos/README.md). */
@Module({
  imports: [InventarioModule],
  controllers: [ReporteStockBajoController, ReporteVentasController],
  providers: [ReporteVentasService],
})
export class ReportesModule {}
