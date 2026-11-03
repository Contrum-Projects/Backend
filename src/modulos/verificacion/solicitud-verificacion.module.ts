import { BullModule } from '@nestjs/bullmq';
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlmacenModule } from '../../almacen/almacen.module.js';
import { COLAS } from '../../colas/colas.js';
import type { Entorno } from '../../config/entorno.js';
import { DocumentosVerificacionService } from './documentos-verificacion.service.js';
import { RevisionVerificacionController } from './revision-verificacion.controller.js';
import { RevisionVerificacionService } from './revision-verificacion.service.js';
import { SolicitudVerificacionController } from './solicitud-verificacion.controller.js';
import { SolicitudVerificacionService } from './solicitud-verificacion.service.js';
import {
  ProveedorKhipu,
  ProveedorNoConfigurado,
} from './sii/proveedor-khipu.js';
import { ProveedorSimulado } from './sii/proveedor-simulado.js';
import { ProveedorSituacionTributaria } from './sii/proveedor-situacion-tributaria.js';

/**
 * Épica 10: verificación de profesionales, solicitud de la cuenta (ver src/modulos/README.md). El
 * SII se consulta por el proveedor que se inyecta como `ProveedorSituacionTributaria`: Khipu; sin
 * `KHIPU_API_KEY` la app arranca, pero la consulta falla y se piden documentos, que se guardan en el
 * almacén de archivos (E10-H2).
 * El personal resuelve las solicitudes en revisión manual (E10-H3). Aprobada, la cuenta pasa a
 * `profesional` y se encola el correo que lo avisa (E10-H4).
 */
@Module({
  imports: [AlmacenModule, BullModule.registerQueue({ name: COLAS.CORREOS })],
  controllers: [
    SolicitudVerificacionController,
    RevisionVerificacionController,
  ],
  providers: [
    {
      provide: ProveedorSituacionTributaria,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<Entorno, true>,
      ): ProveedorSituacionTributaria => {
        if (config.get('SII_PROVEEDOR', { infer: true }) === 'simulado') {
          new Logger('Verificacion').warn(
            'SII simulado: la consulta responde según el último dígito del RUT. Solo para desarrollo.',
          );
          return new ProveedorSimulado();
        }
        const clave = config.get('KHIPU_API_KEY', { infer: true });
        if (!clave) {
          new Logger('Verificacion').warn(
            'Khipu sin configurar: toda solicitud de verificación pedirá documentos.',
          );
          return new ProveedorNoConfigurado();
        }
        return new ProveedorKhipu(
          clave,
          config.get('KHIPU_URL_BASE', { infer: true }),
        );
      },
    },
    SolicitudVerificacionService,
    DocumentosVerificacionService,
    RevisionVerificacionService,
  ],
})
export class SolicitudVerificacionModule {}
