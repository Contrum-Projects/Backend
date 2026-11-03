import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  CUENTA_NO_APROBABLE,
  NO_ESTA_EN_REVISION,
  RevisionVerificacionService,
  SIN_SOLICITUD_CUENTA,
} from './revision-verificacion.service.js';

const PERSONAL = '3f0c2a52-0b9e-4c55-9d0e-6a3a4f6d1b2c';
const CUENTA = '5f1d9c1e-7a3b-4c52-9d8e-0a1b2c3d4e5f';
const AHORA = new Date('2026-11-03T15:00:00.000Z');
const MOTIVO = 'El certificado adjunto no es legible.';

const resolutor = {
  codigoPublico: PERSONAL,
  nombre: 'Rosa',
  apellido: 'Pérez',
};

const crearDb = () => {
  const db = {
    // El bloqueo de la cuenta (`bloquearCuenta`) devuelve su id
    $queryRaw: vi.fn().mockResolvedValue([{ id: 7 }]),
    /** La cuenta que solicitó, tal como se lee con la fila bloqueada. */
    solicitante: { rol: 'cliente', activo: true },
    usuario: {
      // Por id, la cuenta que solicitó; por código público, quien resuelve
      findUniqueOrThrow: vi.fn(),
    },
    solicitudVerificacion: {
      findFirst: vi.fn().mockResolvedValue({
        id: 40,
        estado: 'revision_manual',
        fechaSolicitud: new Date('2026-11-02T18:00:00.000Z'),
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((fn: (t: typeof db) => Promise<unknown>) =>
    fn(db),
  );
  db.usuario.findUniqueOrThrow.mockImplementation(
    (args: { where: { id?: number } }) =>
      Promise.resolve(
        args.where.id === 7 ? db.solicitante : { id: 3, ...resolutor },
      ),
  );
  return db;
};

describe('RevisionVerificacionService', () => {
  let db: ReturnType<typeof crearDb>;
  let servicio: RevisionVerificacionService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AHORA);
    db = crearDb();
    servicio = new RevisionVerificacionService(db as unknown as PrismaService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('E10-H3 · aprobación manual: la deja aprobada y registra quién la resolvió y cuándo', async () => {
    const respuesta = await servicio.aprobar(PERSONAL, CUENTA);

    expect(db.solicitudVerificacion.findFirst.mock.calls[0][0]).toMatchObject({
      where: { solicitanteId: 7 },
      orderBy: { id: 'desc' },
    });
    expect(db.solicitudVerificacion.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 40, estado: 'revision_manual' },
      data: {
        estado: 'aprobada',
        resolutorId: 3,
        fechaResolucion: AHORA,
        motivoRechazo: null,
      },
    });
    expect(respuesta).toEqual({
      codigoPublicoCuenta: CUENTA,
      estado: 'aprobada',
      fechaSolicitud: '2026-11-02T18:00:00.000Z',
      fechaResolucion: AHORA.toISOString(),
      motivoRechazo: null,
      resolutor,
    });
  });

  it('E10-H3 · rechazo con motivo: la deja rechazada y guarda el motivo, quién y cuándo', async () => {
    const respuesta = await servicio.rechazar(PERSONAL, CUENTA, {
      motivo: MOTIVO,
    });

    expect(db.solicitudVerificacion.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 40, estado: 'revision_manual' },
      data: {
        estado: 'rechazada',
        resolutorId: 3,
        fechaResolucion: AHORA,
        motivoRechazo: MOTIVO,
      },
    });
    expect(respuesta).toMatchObject({
      estado: 'rechazada',
      motivoRechazo: MOTIVO,
      fechaResolucion: AHORA.toISOString(),
      resolutor,
    });
  });

  it('bloquea la fila de la cuenta antes de leer la solicitud', async () => {
    await servicio.aprobar(PERSONAL, CUENTA);

    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.solicitudVerificacion.findFirst.mock.invocationCallOrder[0],
    );
  });

  it('no aprueba una cuenta desactivada o que ya no es cliente: 409 sin cambios', async () => {
    for (const solicitante of [
      { rol: 'cliente', activo: false },
      { rol: 'vendedor', activo: true },
      { rol: 'profesional', activo: true },
    ]) {
      db.solicitante = solicitante;

      await expect(servicio.aprobar(PERSONAL, CUENTA)).rejects.toThrow(
        new ConflictException(CUENTA_NO_APROBABLE),
      );
    }
    expect(db.solicitudVerificacion.updateMany).not.toHaveBeenCalled();
  });

  it('rechazar se permite aunque la cuenta esté desactivada o ya no sea cliente', async () => {
    db.solicitante = { rol: 'vendedor', activo: false };

    await expect(
      servicio.rechazar(PERSONAL, CUENTA, { motivo: MOTIVO }),
    ).resolves.toMatchObject({ estado: 'rechazada' });
  });

  it('cuenta que no existe: 404 sin cambios', async () => {
    db.$queryRaw.mockResolvedValue([]);

    await expect(servicio.aprobar(PERSONAL, CUENTA)).rejects.toThrow(
      NotFoundException,
    );
    expect(db.solicitudVerificacion.updateMany).not.toHaveBeenCalled();
  });

  it('cuenta sin solicitudes: 404 sin cambios', async () => {
    db.solicitudVerificacion.findFirst.mockResolvedValue(null);

    await expect(
      servicio.rechazar(PERSONAL, CUENTA, { motivo: MOTIVO }),
    ).rejects.toThrow(new NotFoundException(SIN_SOLICITUD_CUENTA));
    expect(db.solicitudVerificacion.updateMany).not.toHaveBeenCalled();
  });

  it('solicitud que no está en revisión manual (pendiente, aprobada o rechazada): 409 sin cambios', async () => {
    for (const estado of ['pendiente', 'aprobada', 'rechazada']) {
      db.solicitudVerificacion.findFirst.mockResolvedValue({
        id: 40,
        estado,
        fechaSolicitud: new Date(),
      });

      await expect(servicio.aprobar(PERSONAL, CUENTA)).rejects.toThrow(
        new ConflictException(NO_ESTA_EN_REVISION),
      );
      await expect(
        servicio.rechazar(PERSONAL, CUENTA, { motivo: MOTIVO }),
      ).rejects.toThrow(new ConflictException(NO_ESTA_EN_REVISION));
    }
    expect(db.solicitudVerificacion.updateMany).not.toHaveBeenCalled();
  });

  it('si otra persona la resolvió entre la lectura y el cambio, responde 409', async () => {
    db.solicitudVerificacion.updateMany.mockResolvedValue({ count: 0 });

    await expect(servicio.aprobar(PERSONAL, CUENTA)).rejects.toThrow(
      new ConflictException(NO_ESTA_EN_REVISION),
    );
  });
});
