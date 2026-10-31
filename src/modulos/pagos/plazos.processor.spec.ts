import type { Job, Queue } from 'bullmq';
import { EventEmitter } from 'node:events';
import { PlazosProcessor } from './plazos.processor.js';
import type { VencimientoPagoService } from './vencimiento-pago.service.js';

describe('PlazosProcessor', () => {
  let vencimientos: { cancelarVencidos: ReturnType<typeof vi.fn> };
  let plazos: {
    upsertJobScheduler: ReturnType<typeof vi.fn>;
    getBackend: ReturnType<typeof vi.fn>;
  };
  let conexion: EventEmitter;
  let worker: PlazosProcessor;

  beforeEach(() => {
    vencimientos = { cancelarVencidos: vi.fn().mockResolvedValue(undefined) };
    conexion = new EventEmitter();
    plazos = {
      upsertJobScheduler: vi.fn().mockResolvedValue({}),
      getBackend: vi.fn(() => conexion),
    };
    worker = new PlazosProcessor(
      vencimientos as unknown as VencimientoPagoService,
      plazos as unknown as Queue,
    );
  });

  it('E6-H3 · plazo vencido: la tarea periódica cancela los pedidos vencidos', async () => {
    await worker.process({ name: 'cancelar-impagos' } as Job);

    expect(vencimientos.cancelarVencidos).toHaveBeenCalledTimes(1);
  });

  it('un trabajo de otro tipo no cancela pedidos', async () => {
    await worker.process({ name: 'otro' } as Job);

    expect(vencimientos.cancelarVencidos).not.toHaveBeenCalled();
  });

  it('RNF-31 · al arrancar y al reconectar con Redis: programa la tarea cada 30 segundos', () => {
    worker.onModuleInit();
    conexion.emit('ready');

    expect(plazos.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(plazos.upsertJobScheduler.mock.calls[0].slice(0, 2)).toEqual([
      'cancelar-impagos',
      { every: 30_000 },
    ]);
  });

  it('RNF-32 · Redis no responde al programar la tarea: no lanza el error', async () => {
    plazos.upsertJobScheduler.mockRejectedValue(new Error('Redis caído'));

    expect(() => worker.programarRevision()).not.toThrow();
    await vi.waitFor(() =>
      expect(plazos.upsertJobScheduler).toHaveBeenCalled(),
    );
  });
});
