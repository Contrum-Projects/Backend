import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { COLAS, TRABAJOS_SEGUIMIENTO } from '../../colas/colas.js';
import { ActualizarEnviosService } from './actualizar-envios.service.js';

/** Cada cuánto se consulta el estado de los envíos (decisión del 1 de noviembre de 2026, E7-H3). */
const REVISION_CADA_MS = 30 * 60_000;

/** Worker de la cola `seguimiento-envios` (E7-H3): la lógica vive en `ActualizarEnviosService`. */
@Processor(COLAS.SEGUIMIENTO_ENVIOS)
export class SeguimientoProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SeguimientoProcessor.name);

  constructor(
    private readonly envios: ActualizarEnviosService,
    @InjectQueue(COLAS.SEGUIMIENTO_ENVIOS) private readonly cola: Queue,
  ) {
    super();
  }

  onModuleInit() {
    this.programarRevision();
    // Si Redis volvió sin sus datos, la tarea se perdió con ellos (RNF-29)
    this.cola.getBackend().on('ready', () => this.programarRevision());
  }

  programarRevision() {
    // Sin esperar: con Redis caído la app arranca igual y la tarea se crea al volver (RNF-32)
    this.cola
      .upsertJobScheduler(
        TRABAJOS_SEGUIMIENTO.ACTUALIZAR_ENVIOS,
        { every: REVISION_CADA_MS },
        {
          name: TRABAJOS_SEGUIMIENTO.ACTUALIZAR_ENVIOS,
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      )
      .catch((error: Error) => {
        this.logger.warn(
          `No se pudo programar el seguimiento de envíos: ${error.message}`,
        );
      });
  }

  async process(job: Job): Promise<void> {
    if (job.name === TRABAJOS_SEGUIMIENTO.ACTUALIZAR_ENVIOS) {
      await this.envios.actualizar();
    }
  }

  @OnWorkerEvent('failed')
  alFallar(job: Job | undefined, error: Error) {
    this.logger.warn(
      `Falló el trabajo ${job?.name ?? 'desconocido'} ${job?.id ?? ''}: ${error.message}`,
    );
  }
}
