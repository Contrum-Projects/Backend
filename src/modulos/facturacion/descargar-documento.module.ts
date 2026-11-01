import { Module } from '@nestjs/common';
import { AlmacenModule } from '../../almacen/almacen.module.js';
import { DescargarDocumentoController } from './descargar-documento.controller.js';
import { DescargarDocumentoService } from './descargar-documento.service.js';
import { DescargarFacturaPersonalController } from './descargar-factura-personal.controller.js';

/** Épica 9: descarga del documento tributario (ver src/modulos/README.md). */
@Module({
  imports: [AlmacenModule],
  controllers: [
    DescargarDocumentoController,
    DescargarFacturaPersonalController,
  ],
  providers: [DescargarDocumentoService],
})
export class DescargarDocumentoModule {}
