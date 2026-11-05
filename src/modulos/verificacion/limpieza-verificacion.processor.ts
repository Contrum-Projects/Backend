import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { COLAS, TRABAJOS_LIMPIEZA_VERIFICACION } from '../../colas/colas.js';
import { LimpiezaVerificacionService } from './limpieza-verificacion.service.js';

/**
 * Cada cuánto se eliminan los archivos vencidos (decisión del 5 nov 2026): un archivo se borra a
 * más tardar una hora después de cumplir los 30 días. No es una tarea con plazo de RNF-31.
 */
const LIMPIEZA_CADA_MS = 60 * 60 * 1000;

/** Worker de la cola `limpieza-verificaciones` (E10-H6): la lógica vive en `LimpiezaVerificacionService`. */
@Processor(COLAS.LIMPIEZA_VERIFICACIONES)
export class LimpiezaVerificacionProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(LimpiezaVerificacionProcessor.name);

  constructor(
    private readonly limpieza: LimpiezaVerificacionService,
    @InjectQueue(COLAS.LIMPIEZA_VERIFICACIONES) private readonly cola: Queue,
  ) {
    super();
  }

  onModuleInit() {
    this.programarLimpieza();
    // Si Redis volvió sin sus datos, la tarea se perdió con ellos (RNF-29)
    this.cola.getBackend().on('ready', () => this.programarLimpieza());
  }

  programarLimpieza() {
    // Sin esperar: con Redis caído la app arranca igual y la tarea se crea al volver (RNF-32). El
    // job repetible no se duplica entre instancias (RNF-20); si dos pasadas se solapan, borrar es
    // idempotente y la fecha se registra con condición
    this.cola
      .upsertJobScheduler(
        TRABAJOS_LIMPIEZA_VERIFICACION.ELIMINAR_ARCHIVOS,
        { every: LIMPIEZA_CADA_MS },
        {
          name: TRABAJOS_LIMPIEZA_VERIFICACION.ELIMINAR_ARCHIVOS,
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      )
      .catch((error: Error) => {
        this.logger.warn(
          `No se pudo programar la limpieza de archivos de verificación: ${error.message}`,
        );
      });
  }

  async process(job: Job): Promise<void> {
    if (job.name === TRABAJOS_LIMPIEZA_VERIFICACION.ELIMINAR_ARCHIVOS) {
      await this.limpieza.eliminarArchivosVencidos();
    }
  }

  @OnWorkerEvent('failed')
  alFallar(job: Job | undefined, error: Error) {
    // Solo el tipo de error: el mensaje podría traer la ubicación de un archivo
    this.logger.warn(
      `Falló el trabajo ${job?.name ?? 'desconocido'} ${job?.id ?? ''}: ${error.name}`,
    );
  }
}
