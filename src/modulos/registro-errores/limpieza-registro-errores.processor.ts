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
  TRABAJOS_LIMPIEZA_REGISTRO_ERRORES,
} from '../../colas/colas.js';
import { ConsultaRegistroErroresService } from './consulta-registro-errores.service.js';

/** Una vez al día: un error se borra a más tardar un día después de cumplir los 90. */
const LIMPIEZA_CADA_MS = 24 * 60 * 60 * 1000;

/** Worker de la cola `limpieza-registro-errores` (SCRUM-168). */
@Processor(COLAS.LIMPIEZA_REGISTRO_ERRORES)
export class LimpiezaRegistroErroresProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(LimpiezaRegistroErroresProcessor.name);

  constructor(
    private readonly consulta: ConsultaRegistroErroresService,
    @InjectQueue(COLAS.LIMPIEZA_REGISTRO_ERRORES) private readonly cola: Queue,
  ) {
    super();
  }

  onModuleInit() {
    this.programarLimpieza();
    // Si Redis volvió sin sus datos, la tarea se perdió con ellos (RNF-29)
    this.cola.getBackend().on('ready', () => this.programarLimpieza());
  }

  programarLimpieza() {
    // Sin esperar: con Redis caído la app arranca igual (RNF-32). El job repetible no se duplica
    // entre instancias (RNF-20) y borrar es idempotente
    this.cola
      .upsertJobScheduler(
        TRABAJOS_LIMPIEZA_REGISTRO_ERRORES.ELIMINAR_ANTIGUOS,
        { every: LIMPIEZA_CADA_MS },
        {
          name: TRABAJOS_LIMPIEZA_REGISTRO_ERRORES.ELIMINAR_ANTIGUOS,
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      )
      .catch((error: Error) => {
        this.logger.warn(
          `No se pudo programar la limpieza del registro de errores: ${error.message}`,
        );
      });
  }

  async process(job: Job): Promise<void> {
    if (job.name === TRABAJOS_LIMPIEZA_REGISTRO_ERRORES.ELIMINAR_ANTIGUOS) {
      await this.consulta.eliminarAntiguos();
    }
  }

  @OnWorkerEvent('failed')
  alFallar(job: Job | undefined, error: Error) {
    this.logger.warn(
      `Falló el trabajo ${job?.name ?? 'desconocido'} ${job?.id ?? ''}: ${error.name}`,
    );
  }
}
