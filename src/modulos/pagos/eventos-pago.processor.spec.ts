import type { Job, Queue } from 'bullmq';
import { EventEmitter } from 'node:events';
import type { TrabajoProcesarEventoPago } from '../../colas/colas.js';
import { EventosPagoProcessor } from './eventos-pago.processor.js';
import type { NotificacionPagoService } from './notificacion-pago.service.js';

describe('EventosPagoProcessor', () => {
  let notificaciones: {
    procesar: ReturnType<typeof vi.fn>;
    revisarPendientes: ReturnType<typeof vi.fn>;
  };
  let eventos: {
    upsertJobScheduler: ReturnType<typeof vi.fn>;
    getBackend: ReturnType<typeof vi.fn>;
  };
  let conexion: EventEmitter;
  let worker: EventosPagoProcessor;

  const trabajo = (name: string, data: unknown = {}) =>
    ({ name, data }) as Job<TrabajoProcesarEventoPago>;

  beforeEach(() => {
    notificaciones = {
      procesar: vi.fn().mockResolvedValue(undefined),
      revisarPendientes: vi.fn().mockResolvedValue(undefined),
    };
    conexion = new EventEmitter();
    eventos = {
      upsertJobScheduler: vi.fn().mockResolvedValue({}),
      getBackend: vi.fn(() => conexion),
    };
    worker = new EventosPagoProcessor(
      notificaciones as unknown as NotificacionPagoService,
      eventos as unknown as Queue,
    );
  });

  it('E6-H2 · trabajo de un evento: lo procesa con su id', async () => {
    await worker.process(trabajo('procesar-evento', { eventoId: 7 }));

    expect(notificaciones.procesar).toHaveBeenCalledWith(7);
    expect(notificaciones.revisarPendientes).not.toHaveBeenCalled();
  });

  it('E6-H2 · tarea periódica: revisa los eventos pendientes', async () => {
    await worker.process(trabajo('revisar-pendientes'));

    expect(notificaciones.revisarPendientes).toHaveBeenCalledTimes(1);
    expect(notificaciones.procesar).not.toHaveBeenCalled();
  });

  it('E6-H2 · al arrancar y al reconectar con Redis: programa la revisión cada minuto (RNF-29)', () => {
    worker.onModuleInit();
    conexion.emit('ready');

    expect(eventos.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(eventos.upsertJobScheduler.mock.calls[0].slice(0, 2)).toEqual([
      'revisar-pendientes',
      { every: 60_000 },
    ]);
  });

  it('E6-H2 · Redis no responde al programar la revisión: no lanza el error (RNF-32)', async () => {
    eventos.upsertJobScheduler.mockRejectedValue(new Error('Redis caído'));

    expect(() => worker.programarRevision()).not.toThrow();
    await vi.waitFor(() =>
      expect(eventos.upsertJobScheduler).toHaveBeenCalled(),
    );
  });
});
