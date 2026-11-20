import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ErroresClienteController } from './errores-cliente.controller.js';
import { FiltroErrores } from './filtro-errores.js';
import { RegistroErroresService } from './registro-errores.service.js';

/**
 * Registro de errores (SCRUM-168, transversal): el filtro global guarda los errores no controlados
 * de la API y la ruta de reportes recibe los de la tienda y el panel.
 */
@Module({
  controllers: [ErroresClienteController],
  providers: [
    RegistroErroresService,
    { provide: APP_FILTER, useClass: FiltroErrores },
  ],
})
export class RegistroErroresModule {}
