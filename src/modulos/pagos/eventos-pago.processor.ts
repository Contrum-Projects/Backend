import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import {
  COLAS,
  TRABAJOS_EVENTO_PAGO,
  type TrabajoProcesarEventoPago,
} from '../../colas/colas.js';
import { NotificacionPagoService } from './notificacion-pago.service.js';

/** Cada cuánto se revisan los eventos pendientes (E6-H3 aplica los pagos antes de cancelar). */
const REVISION_CADA_MS = 60_000;

/** Worker de la cola `eventos-pago` (E6-H2): la lógica vive en `NotificacionPagoService`. */
@Processor(COLAS.EVENTOS_PAGO)
export class EventosPagoProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(EventosPagoProcessor.name);

  constructor(
    private readonly notificaciones: NotificacionPagoService,
    @InjectQueue(COLAS.EVENTOS_PAGO) private readonly eventos: Queue,
  ) {
    super();
  }

  onModuleInit() {
    this.programarRevision();
  }

  // Al reconectar: si Redis volvió sin sus datos, la tarea se perdió con ellos (RNF-29)
  @OnWorkerEvent('ready')
  programarRevision() {
    // Sin esperar: con Redis caído la app arranca igual y la tarea se crea al volver (RNF-32).
    // Un job repetible corre una sola vez aunque haya varias instancias (RNF-20)
    this.eventos
      .upsertJobScheduler(
        TRABAJOS_EVENTO_PAGO.REVISAR_PENDIENTES,
        { every: REVISION_CADA_MS },
        {
          name: TRABAJOS_EVENTO_PAGO.REVISAR_PENDIENTES,
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      )
      .catch((error: Error) => {
        this.logger.warn(
          `No se pudo programar la revisión de eventos de pago: ${error.message}`,
        );
      });
  }

  async process(job: Job<TrabajoProcesarEventoPago>): Promise<void> {
    if (job.name === TRABAJOS_EVENTO_PAGO.REVISAR_PENDIENTES) {
      await this.notificaciones.revisarPendientes();
      return;
    }
    await this.notificaciones.procesar(job.data.eventoId);
  }

  // Solo el motivo y el id: el cuerpo de la notificación no va al log
  @OnWorkerEvent('failed')
  alFallar(job: Job<TrabajoProcesarEventoPago> | undefined, error: Error) {
    this.logger.warn(
      `Falló el trabajo ${job?.name ?? 'desconocido'} ${job?.id ?? ''}: ${error.message}`,
    );
  }
}
