import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import { TRABAJOS_CORREO, type TrabajoCorreo } from '../../colas/colas.js';
import type { Entorno } from '../../config/entorno.js';
import { ErrorEnvioCorreo } from './cliente-correo.js';
import { CorreosProcessor } from './correos.processor.js';
import type { EnvioCorreosService } from './envio-correos.service.js';
import type { RevisionCorreosService } from './revision-correos.service.js';

const TOKEN = 'token-en-claro';
const DATOS = {
  notificacionId: 7,
  destinatario: 'camila@correo.cl',
  nombre: 'Camila',
  enlace: `https://tienda.cl/confirmar-correo?token=${TOKEN}`,
};

const trabajo = (
  nombre: string,
  attemptsMade: number,
  attempts: number | undefined = 5,
) =>
  ({
    id: 'correo-7',
    name: nombre,
    data: DATOS,
    attemptsMade,
    opts: { attempts },
  }) as unknown as Job<TrabajoCorreo>;

describe('CorreosProcessor', () => {
  let envio: {
    enviar: ReturnType<typeof vi.fn>;
    marcarFallida: ReturnType<typeof vi.fn>;
  };
  let revision: { revisarPendientes: ReturnType<typeof vi.fn> };
  let cola: {
    upsertJobScheduler: ReturnType<typeof vi.fn>;
    getBackend: ReturnType<typeof vi.fn>;
  };
  let advertir: ReturnType<typeof vi.spyOn>;

  const crear = (activo = true) =>
    new CorreosProcessor(
      envio as unknown as EnvioCorreosService,
      revision as unknown as RevisionCorreosService,
      { get: () => activo } as unknown as ConfigService<Entorno, true>,
      cola as unknown as Queue,
    );

  beforeEach(() => {
    envio = {
      enviar: vi.fn().mockResolvedValue(undefined),
      marcarFallida: vi.fn().mockResolvedValue(undefined),
    };
    revision = { revisarPendientes: vi.fn().mockResolvedValue(undefined) };
    cola = {
      upsertJobScheduler: vi.fn().mockResolvedValue({}),
      getBackend: vi.fn().mockReturnValue({ on: vi.fn() }),
    };
    advertir = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => advertir.mockRestore());

  it('E1-H6 · correo enviado: cada trabajo va al servicio de envío', async () => {
    await crear().process(trabajo(TRABAJOS_CORREO.CONFIRMACION_CORREO, 0));

    expect(envio.enviar).toHaveBeenCalledWith(
      TRABAJOS_CORREO.CONFIRMACION_CORREO,
      DATOS,
    );
    expect(revision.revisarPendientes).not.toHaveBeenCalled();
  });

  it('E1-H6 · correo pendiente: la tarea repetible corre la revisión, y no envía', async () => {
    await crear().process(trabajo(TRABAJOS_CORREO.REVISAR_PENDIENTES, 0));

    expect(revision.revisarPendientes).toHaveBeenCalled();
    expect(envio.enviar).not.toHaveBeenCalled();
  });

  it('E1-H6 · correo pendiente: programa la revisión cada minuto', () => {
    crear().programarRevision();

    expect(cola.upsertJobScheduler.mock.calls[0].slice(0, 2)).toEqual([
      TRABAJOS_CORREO.REVISAR_PENDIENTES,
      { every: 60_000 },
    ]);
  });

  it('E1-H6 · RNF-32: si Redis no responde al programar la revisión, solo se advierte', async () => {
    cola.upsertJobScheduler.mockRejectedValue(new Error('Redis caído'));

    crear().programarRevision();

    await vi.waitFor(() => expect(advertir).toHaveBeenCalled());
  });

  it('E1-H6 · con CORREOS_WORKER_ACTIVO en falso, el worker no parte', () => {
    const procesador = crear(false);
    const iniciar = vi
      .spyOn(procesador, 'iniciar')
      .mockImplementation(() => {});

    procesador.onApplicationBootstrap();

    expect(iniciar).not.toHaveBeenCalled();
  });

  it('E1-H6 · envío fallido: al agotar los reintentos marca la NOTIFICACION como fallida', async () => {
    await crear().alFallar(
      trabajo(TRABAJOS_CORREO.CONFIRMACION_CORREO, 5),
      new ErrorEnvioCorreo('rechazado'),
    );

    expect(envio.marcarFallida).toHaveBeenCalledWith(7);
  });

  it('E1-H6 · envío fallido: mientras queden reintentos sigue pendiente', async () => {
    await crear().alFallar(
      trabajo(TRABAJOS_CORREO.CONFIRMACION_CORREO, 4),
      new ErrorEnvioCorreo('rechazado'),
    );

    expect(envio.marcarFallida).not.toHaveBeenCalled();
  });

  it('E1-H6 · envío fallido: si la revisión falla, no toca ninguna notificación', async () => {
    await crear().alFallar(
      trabajo(TRABAJOS_CORREO.REVISAR_PENDIENTES, 5),
      new Error('base caída'),
    );

    expect(envio.marcarFallida).not.toHaveBeenCalled();
  });

  it('E1-H6 · envío fallido: si no se puede marcar, no rompe el worker (queda para la revisión)', async () => {
    envio.marcarFallida.mockRejectedValue(new Error('base caída'));

    await expect(
      crear().alFallar(
        trabajo(TRABAJOS_CORREO.CONFIRMACION_CORREO, 5),
        new ErrorEnvioCorreo('rechazado'),
      ),
    ).resolves.toBeUndefined();
  });

  it('E1-H6 · enlace protegido: el log no lleva el token ni el mensaje de un error inesperado', async () => {
    await crear().alFallar(
      trabajo(TRABAJOS_CORREO.CONFIRMACION_CORREO, 1),
      new TypeError(`fallo con ${DATOS.enlace} para ${DATOS.destinatario}`),
    );

    const registrado = JSON.stringify(advertir.mock.calls);
    expect(registrado).toContain('correo-7');
    expect(registrado).toContain('TypeError');
    expect(registrado).not.toContain(TOKEN);
    expect(registrado).not.toContain(DATOS.destinatario);
  });
});
