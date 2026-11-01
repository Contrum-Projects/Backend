import { Module } from '@nestjs/common';
import { AlmacenModule } from '../../almacen/almacen.module.js';
import { RegistrarFacturaController } from './registrar-factura.controller.js';
import { RegistrarFacturaService } from './registrar-factura.service.js';

/** Épica 9: documentos tributarios, registro de la factura (ver src/modulos/README.md). */
@Module({
  imports: [AlmacenModule],
  controllers: [RegistrarFacturaController],
  providers: [RegistrarFacturaService],
})
export class RegistrarFacturaModule {}
