import type { Job, Queue } from 'bullmq';
import { EventEmitter } from 'node:events';
import { LimpiezaVerificacionProcessor } from './limpieza-verificacion.processor.js';
import type { LimpiezaVerificacionService } from './limpieza-verificacion.service.js';

describe('LimpiezaVerificacionProcessor', () => {
  let limpieza: { eliminarArchivosVencidos: ReturnType<typeof vi.fn> };
  let cola: {
    upsertJobScheduler: ReturnType<typeof vi.fn>;
    getBackend: ReturnType<typeof vi.fn>;
  };
  let conexion: EventEmitter;
  let worker: LimpiezaVerificacionProcessor;

  beforeEach(() => {
    limpieza = {
      eliminarArchivosVencidos: vi
        .fn()
        .mockResolvedValue({ eliminados: 0, fallidos: 0 }),
    };
    conexion = new EventEmitter();
    cola = {
      upsertJobScheduler: vi.fn().mockResolvedValue({}),
      getBackend: vi.fn(() => conexion),
    };
    worker = new LimpiezaVerificacionProcessor(
      limpieza as unknown as LimpiezaVerificacionService,
      cola as unknown as Queue,
    );
  });

  it('E10-H6 · limpieza programada: el trabajo elimina los archivos vencidos', async () => {
    await worker.process({ name: 'eliminar-archivos' } as Job);

    expect(limpieza.eliminarArchivosVencidos).toHaveBeenCalledTimes(1);
  });

  it('un trabajo de otro tipo no elimina archivos', async () => {
    await worker.process({ name: 'otro' } as Job);

    expect(limpieza.eliminarArchivosVencidos).not.toHaveBeenCalled();
  });

  it('E10-H6 · al arrancar y al reconectar con Redis: programa la limpieza cada hora', () => {
    worker.onModuleInit();
    conexion.emit('ready');

    expect(cola.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(cola.upsertJobScheduler.mock.calls[0].slice(0, 2)).toEqual([
      'eliminar-archivos',
      { every: 60 * 60 * 1000 },
    ]);
  });

  it('RNF-32 · Redis no responde al programar la limpieza: no lanza el error', async () => {
    cola.upsertJobScheduler.mockRejectedValue(new Error('Redis caído'));

    expect(() => worker.programarLimpieza()).not.toThrow();
    await vi.waitFor(() => expect(cola.upsertJobScheduler).toHaveBeenCalled());
  });
});
