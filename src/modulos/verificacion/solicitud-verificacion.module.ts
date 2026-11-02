import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';
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
 * `KHIPU_API_KEY` la app arranca, pero la consulta falla y se piden documentos.
 */
@Module({
  controllers: [SolicitudVerificacionController],
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
  ],
})
export class SolicitudVerificacionModule {}
