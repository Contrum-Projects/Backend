import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { COLAS, TRABAJOS_CARRITO_ABANDONADO } from '../../colas/colas.js';
import { CarritosAbandonadosService } from './carritos-abandonados.service.js';

/** Cada cuánto se revisan los carritos: el atraso máximo de una tarea con plazo es 1 minuto (RNF-31). */
const REVISION_CADA_MS = 30_000;

/** Worker de la cola `carritos-abandonados` (E12-H4): la lógica vive en `CarritosAbandonadosService`. */
@Processor(COLAS.CARRITOS_ABANDONADOS)
export class CarritosAbandonadosProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(CarritosAbandonadosProcessor.name);

  constructor(
    private readonly carritos: CarritosAbandonadosService,
    @InjectQueue(COLAS.CARRITOS_ABANDONADOS) private readonly cola: Queue,
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
        TRABAJOS_CARRITO_ABANDONADO.RECORDAR,
        { every: REVISION_CADA_MS },
        {
          name: TRABAJOS_CARRITO_ABANDONADO.RECORDAR,
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      )
      .catch((error: Error) => {
        this.logger.warn(
          `No se pudo programar los recordatorios de carrito: ${error.message}`,
        );
      });
  }

  async process(job: Job): Promise<void> {
    if (job.name === TRABAJOS_CARRITO_ABANDONADO.RECORDAR) {
      await this.carritos.enviarRecordatorios();
    }
  }

  @OnWorkerEvent('failed')
  alFallar(job: Job | undefined, error: Error) {
    this.logger.warn(
      `Falló el trabajo ${job?.name ?? 'desconocido'} ${job?.id ?? ''}: ${error.message}`,
    );
  }
}
