import { BullModule } from '@nestjs/bullmq';
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlmacenModule } from '../../almacen/almacen.module.js';
import { COLAS } from '../../colas/colas.js';
import type { Entorno } from '../../config/entorno.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConsultaVerificacionController } from './consulta-verificacion.controller.js';
import { ConsultaVerificacionService } from './consulta-verificacion.service.js';
import { DocumentosVerificacionService } from './documentos-verificacion.service.js';
import { LimpiezaVerificacionProcessor } from './limpieza-verificacion.processor.js';
import { LimpiezaVerificacionService } from './limpieza-verificacion.service.js';
import { PerfilProfesionalController } from './perfil-profesional.controller.js';
import { PerfilProfesionalService } from './perfil-profesional.service.js';
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
 * `KHIPU_CLIENT_ID` y `KHIPU_CLIENT_SECRET` la app arranca, pero la consulta falla y se piden
 * documentos, que se guardan en el
 * almacén de archivos (E10-H2).
 * El personal resuelve las solicitudes en revisión manual (E10-H3) y las consulta con sus
 * documentos (E10-H7). Aprobada, la cuenta pasa a `profesional` y se encola el correo que lo avisa
 * (E10-H4), que luego completa su perfil profesional (E10-H5). Una tarea programada elimina los
 * archivos 30 días después de resuelta la solicitud (E10-H6).
 */
@Module({
  imports: [
    AlmacenModule,
    BullModule.registerQueue(
      { name: COLAS.CORREOS },
      { name: COLAS.LIMPIEZA_VERIFICACIONES },
    ),
  ],
  controllers: [
    SolicitudVerificacionController,
    RevisionVerificacionController,
    // Después de SolicitudVerificacionController: `GET /verificaciones/yo` va antes que `:codigoPublico`
    ConsultaVerificacionController,
    PerfilProfesionalController,
  ],
  providers: [
    {
      provide: ProveedorSituacionTributaria,
      inject: [ConfigService, PrismaService],
      useFactory: (
        config: ConfigService<Entorno, true>,
        prisma: PrismaService,
      ): ProveedorSituacionTributaria => {
        if (config.get('SII_PROVEEDOR', { infer: true }) === 'simulado') {
          new Logger('Verificacion').warn(
            'SII simulado: la consulta responde según el último dígito del RUT. Solo para desarrollo.',
          );
          return new ProveedorSimulado(prisma);
        }
        const idCliente = config.get('KHIPU_CLIENT_ID', { infer: true });
        const secreto = config.get('KHIPU_CLIENT_SECRET', { infer: true });
        if (!idCliente || !secreto) {
          new Logger('Verificacion').warn(
            'Khipu sin configurar: toda solicitud de verificación pedirá documentos.',
          );
          return new ProveedorNoConfigurado();
        }
        return new ProveedorKhipu(
          { idCliente, secreto },
          config.get('KHIPU_URL_BASE', { infer: true }),
          config.get('KHIPU_URL_AUTH', { infer: true }),
        );
      },
    },
    SolicitudVerificacionService,
    DocumentosVerificacionService,
    RevisionVerificacionService,
    ConsultaVerificacionService,
    PerfilProfesionalService,
    LimpiezaVerificacionService,
    LimpiezaVerificacionProcessor,
  ],
})
export class SolicitudVerificacionModule {}
