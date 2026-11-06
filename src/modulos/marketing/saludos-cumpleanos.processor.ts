import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { COLAS, TRABAJOS_CUMPLEANOS } from '../../colas/colas.js';
import { SaludosCumpleanosService } from './saludos-cumpleanos.service.js';

/** Cada cuánto se buscan cumpleaños: el atraso máximo de una tarea con plazo es 1 minuto (RNF-31). */
const REVISION_CADA_MS = 30_000;

/** Worker de la cola `cumpleanos` (E12-H5): la lógica vive en `SaludosCumpleanosService`. */
@Processor(COLAS.CUMPLEANOS)
export class SaludosCumpleanosProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(SaludosCumpleanosProcessor.name);

  constructor(
    private readonly saludos: SaludosCumpleanosService,
    @InjectQueue(COLAS.CUMPLEANOS) private readonly cola: Queue,
  ) {
    super();
  }

  onModuleInit() {
    this.programarRevision();
    // Si Redis volvió sin sus datos, la tarea se perdió con ellos (RNF-29)
    this.cola.getBackend().on('ready', () => this.programarRevision());
  }

  programarRevision() {
    // Sin esperar: con Redis caído la app arranca igual y la tarea se crea al volver (RNF-32). El
    // job repetible no se duplica entre instancias (RNF-20); si dos pasadas se solapan, el bloqueo
    // de la cuenta las ordena
    this.cola
      .upsertJobScheduler(
        TRABAJOS_CUMPLEANOS.SALUDAR,
        { every: REVISION_CADA_MS },
        {
          name: TRABAJOS_CUMPLEANOS.SALUDAR,
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      )
      .catch((error: Error) => {
        this.logger.warn(
          `No se pudo programar los saludos de cumpleaños: ${error.message}`,
        );
      });
  }

  async process(job: Job): Promise<void> {
    if (job.name === TRABAJOS_CUMPLEANOS.SALUDAR) {
      await this.saludos.enviarSaludos();
    }
  }

  @OnWorkerEvent('failed')
  alFallar(job: Job | undefined, error: Error) {
    this.logger.warn(
      `Falló el trabajo ${job?.name ?? 'desconocido'} ${job?.id ?? ''}: ${error.message}`,
    );
  }
}
