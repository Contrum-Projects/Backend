import { Module } from '@nestjs/common';
import { InventarioModule } from '../inventario/inventario.module.js';
import { ReporteCampanasController } from './reporte-campanas.controller.js';
import { ReporteCampanasService } from './reporte-campanas.service.js';
import { ReporteCarritosController } from './reporte-carritos.controller.js';
import { ReporteCarritosService } from './reporte-carritos.service.js';
import { ReporteIndicadoresController } from './reporte-indicadores.controller.js';
import { ReporteIndicadoresService } from './reporte-indicadores.service.js';
import { ReporteStockBajoController } from './reporte-stock-bajo.controller.js';
import { ReporteVentasController } from './reporte-ventas.controller.js';
import { ReporteVentasService } from './reporte-ventas.service.js';

/** Épica 14: indicadores y reportes del panel (ver src/modulos/README.md). */
@Module({
  imports: [InventarioModule],
  controllers: [
    ReporteStockBajoController,
    ReporteVentasController,
    ReporteIndicadoresController,
    ReporteCarritosController,
    ReporteCampanasController,
  ],
  providers: [
    ReporteVentasService,
    ReporteIndicadoresService,
    ReporteCarritosService,
    ReporteCampanasService,
  ],
})
export class ReportesModule {}
