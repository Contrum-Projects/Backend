import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoCorreo,
} from '../../colas/colas.js';
import type { Entorno } from '../../config/entorno.js';
import { ErrorEnvioCorreo } from './cliente-correo.js';
import { EnvioCorreosService } from './envio-correos.service.js';
import { RevisionCorreosService } from './revision-correos.service.js';

/** Frecuencia de la revisión de pendientes: la misma de los eventos de pago (RNF-29). */
const REVISION_CADA_MS = 60_000;

/**
 * Worker de la cola `correos` (E1-H6): la lógica vive en los servicios. Parte detenido para poder
 * apagarlo con `CORREOS_WORKER_ACTIVO` (los e2e leen los trabajos de la cola). El límite respeta
 * el de la API de Resend, y cuenta entre todas las instancias (RNF-20).
 */
@Processor(COLAS.CORREOS, {
  autorun: false,
  limiter: { max: 2, duration: 1_000 },
})
export class CorreosProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(CorreosProcessor.name);

  constructor(
    private readonly envio: EnvioCorreosService,
    private readonly revision: RevisionCorreosService,
    private readonly config: ConfigService<Entorno, true>,
    @InjectQueue(COLAS.CORREOS) private readonly correos: Queue,
  ) {
    super();
  }

  onApplicationBootstrap() {
    if (this.config.get('CORREOS_WORKER_ACTIVO', { infer: true })) {
      this.iniciar();
    }
  }

  iniciar() {
    this.worker.run().catch((error: Error) => {
      this.logger.error(`El worker de correos se detuvo: ${error.name}`);
    });
    this.programarRevision();
    // Si Redis volvió sin sus datos, la tarea se perdió con ellos (RNF-29). El `ready` del worker
    // se emite una sola vez: el de la conexión de la cola avisa cada reconexión
    this.correos.getBackend().on('ready', () => this.programarRevision());
  }

  programarRevision() {
    // Sin esperar: con Redis caído la app arranca igual y la tarea se crea al volver (RNF-32).
    // Un job repetible corre una sola vez aunque haya varias instancias (RNF-20)
    this.correos
      .upsertJobScheduler(
        TRABAJOS_CORREO.REVISAR_PENDIENTES,
        { every: REVISION_CADA_MS },
        {
          name: TRABAJOS_CORREO.REVISAR_PENDIENTES,
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      )
      .catch((error: Error) => {
        this.logger.warn(
          `No se pudo programar la revisión de correos: ${error.name}`,
        );
      });
  }

  async process(job: Job<TrabajoCorreo>): Promise<void> {
    if (job.name === TRABAJOS_CORREO.REVISAR_PENDIENTES) {
      await this.revision.revisarPendientes();
      return;
    }
    await this.envio.enviar(job.name, job.data);
  }

  /**
   * Solo el trabajo y un motivo controlado: el trabajo puede llevar un enlace con su token y otros
   * errores podrían citar sus datos (RNF-02, RNF-08). Al agotar los reintentos, `fallida`.
   */
  @OnWorkerEvent('failed')
  async alFallar(job: Job<TrabajoCorreo> | undefined, error: Error) {
    const motivo =
      error instanceof ErrorEnvioCorreo ? error.message : error.name;
    this.logger.warn(
      `Falló el trabajo ${job?.name ?? 'desconocido'} ${job?.id ?? ''}: ${motivo}`,
    );
    if (!job || job.name === TRABAJOS_CORREO.REVISAR_PENDIENTES) return;
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
    try {
      await this.envio.marcarFallida(job.data.notificacionId);
    } catch (fallo) {
      // Sigue pendiente: la revisión periódica la resolverá
      this.logger.warn(
        `No se pudo marcar como fallida la notificación ${job.data.notificacionId}: ${(fallo as Error).name}`,
      );
    }
  }
}
