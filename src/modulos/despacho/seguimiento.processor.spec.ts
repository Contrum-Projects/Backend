import type { Job, Queue } from 'bullmq';
import { EventEmitter } from 'node:events';
import type { ActualizarEnviosService } from './actualizar-envios.service.js';
import { SeguimientoProcessor } from './seguimiento.processor.js';

describe('SeguimientoProcessor', () => {
  let envios: { actualizar: ReturnType<typeof vi.fn> };
  let cola: {
    upsertJobScheduler: ReturnType<typeof vi.fn>;
    getBackend: ReturnType<typeof vi.fn>;
  };
  let conexion: EventEmitter;
  let worker: SeguimientoProcessor;

  beforeEach(() => {
    envios = { actualizar: vi.fn().mockResolvedValue(undefined) };
    conexion = new EventEmitter();
    cola = {
      upsertJobScheduler: vi.fn().mockResolvedValue({}),
      getBackend: vi.fn(() => conexion),
    };
    worker = new SeguimientoProcessor(
      envios as unknown as ActualizarEnviosService,
      cola as unknown as Queue,
    );
  });

  it('E7-H3 · estado actualizado: la tarea periódica consulta los envíos', async () => {
    await worker.process({ name: 'actualizar-envios' } as Job);

    expect(envios.actualizar).toHaveBeenCalledTimes(1);
  });

  it('un trabajo de otro tipo no consulta los envíos', async () => {
    await worker.process({ name: 'otro' } as Job);

    expect(envios.actualizar).not.toHaveBeenCalled();
  });

  it('E7-H3 · al arrancar y al reconectar con Redis: programa la tarea cada 30 minutos', () => {
    worker.onModuleInit();
    conexion.emit('ready');

    expect(cola.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(cola.upsertJobScheduler.mock.calls[0].slice(0, 2)).toEqual([
      'actualizar-envios',
      { every: 1_800_000 },
    ]);
  });

  it('RNF-32 · Redis no responde al programar la tarea: no lanza el error', async () => {
    cola.upsertJobScheduler.mockRejectedValue(new Error('Redis caído'));

    expect(() => worker.programarRevision()).not.toThrow();
    await vi.waitFor(() => expect(cola.upsertJobScheduler).toHaveBeenCalled());
  });
});
