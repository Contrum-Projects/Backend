import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { COLAS } from '../../colas/colas.js';
import type { Entorno } from '../../config/entorno.js';
import {
  CLIENTE_CORREO,
  type ClienteCorreo,
  ClienteCorreoSimulado,
  ClienteResend,
} from './cliente-correo.js';
import { ContenidoCorreosService } from './contenido-correos.service.js';
import { CorreosProcessor } from './correos.processor.js';
import { EnvioCorreosService } from './envio-correos.service.js';
import { RevisionCorreosService } from './revision-correos.service.js';

/** Envío de los correos de la cola `correos` (E1-H6; ver src/modulos/README.md). */
@Module({
  imports: [BullModule.registerQueue({ name: COLAS.CORREOS })],
  providers: [
    {
      provide: CLIENTE_CORREO,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Entorno, true>): ClienteCorreo => {
        const clave = config.get('RESEND_API_KEY', { infer: true });
        const remitente = config.get('CORREO_REMITENTE', { infer: true });
        // El entorno exige ambas juntas y en producción: sin ellas, solo fuera de producción
        return clave && remitente
          ? new ClienteResend(clave, remitente)
          : new ClienteCorreoSimulado();
      },
    },
    ContenidoCorreosService,
    EnvioCorreosService,
    RevisionCorreosService,
    CorreosProcessor,
  ],
})
export class NotificacionesModule {}
