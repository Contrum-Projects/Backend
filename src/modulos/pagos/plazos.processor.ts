import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { COLAS, TRABAJOS_PLAZO } from '../../colas/colas.js';
import { VencimientoPagoService } from './vencimiento-pago.service.js';

/** Cada cuánto se revisan los plazos: el atraso máximo permitido es de 1 minuto (RNF-31). */
const REVISION_CADA_MS = 30_000;

/** Worker de la cola `plazos` (E6-H3): la lógica vive en `VencimientoPagoService`. */
@Processor(COLAS.PLAZOS)
export class PlazosProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(PlazosProcessor.name);

  constructor(
    private readonly vencimientos: VencimientoPagoService,
    @InjectQueue(COLAS.PLAZOS) private readonly plazos: Queue,
  ) {
    super();
  }

  onModuleInit() {
    this.programarRevision();
    // Si Redis volvió sin sus datos, la tarea se perdió con ellos (RNF-29). El `ready` del worker
    // se emite una sola vez: el de la conexión de la cola avisa cada reconexión
    this.plazos.getBackend().on('ready', () => this.programarRevision());
  }

  programarRevision() {
    // Sin esperar: con Redis caído la app arranca igual y la tarea se crea al volver (RNF-32).
    // El job repetible no se duplica entre instancias (RNF-20); si dos pasadas largas se solapan,
    // el bloqueo de la fila del pedido las ordena
    this.plazos
      .upsertJobScheduler(
        TRABAJOS_PLAZO.CANCELAR_IMPAGOS,
        { every: REVISION_CADA_MS },
        {
          name: TRABAJOS_PLAZO.CANCELAR_IMPAGOS,
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      )
      .catch((error: Error) => {
        this.logger.warn(
          `No se pudo programar la cancelación por impago: ${error.message}`,
        );
      });
  }

  async process(job: Job): Promise<void> {
    if (job.name === TRABAJOS_PLAZO.CANCELAR_IMPAGOS) {
      await this.vencimientos.cancelarVencidos();
    }
  }

  @OnWorkerEvent('failed')
  alFallar(job: Job | undefined, error: Error) {
    this.logger.warn(
      `Falló el trabajo ${job?.name ?? 'desconocido'} ${job?.id ?? ''}: ${error.message}`,
    );
  }
}
