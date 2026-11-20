import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { COLAS } from '../../colas/colas.js';
import { ConsultaRegistroErroresService } from './consulta-registro-errores.service.js';
import { ErroresClienteController } from './errores-cliente.controller.js';
import { FiltroErrores } from './filtro-errores.js';
import { LimpiezaRegistroErroresProcessor } from './limpieza-registro-errores.processor.js';
import { RegistroErroresController } from './registro-errores.controller.js';
import { RegistroErroresService } from './registro-errores.service.js';

/**
 * Registro de errores (SCRUM-168, transversal): el filtro global guarda los errores no controlados
 * de la API, la ruta de reportes recibe los de la tienda y el panel, el administrador los consulta
 * en el panel y una tarea diaria borra los de más de 90 días.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: COLAS.LIMPIEZA_REGISTRO_ERRORES }),
  ],
  controllers: [ErroresClienteController, RegistroErroresController],
  providers: [
    RegistroErroresService,
    ConsultaRegistroErroresService,
    LimpiezaRegistroErroresProcessor,
    { provide: APP_FILTER, useClass: FiltroErrores },
  ],
})
export class RegistroErroresModule {}
