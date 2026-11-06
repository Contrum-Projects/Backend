import type { Queue } from 'bullmq';
import { PRIORIDAD_CORREO, TRABAJOS_CORREO } from '../../colas/colas.js';
import { ROLES } from '../../common/dominio/roles.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ASUNTO_CUMPLEANOS_POR_DEFECTO } from './saludo-cumpleanos.js';
import { SaludosCumpleanosService } from './saludos-cumpleanos.service.js';

/** Jueves 5 de noviembre de 2026, 10:00 en Chile (UTC-3). */
const AHORA = new Date('2026-11-05T13:00:00.000Z');
const CODIGO = '6f1c1b1e-0000-4000-8000-000000000001';

interface CuentaPrueba {
  email: string;
  nombre: string;
  activo: boolean;
  rol: string;
  aceptaMarketingEmail: boolean;
  fechaVerificacionCorreo: Date | null;
  fechaNacimiento: Date | null;
}

const CUENTA: CuentaPrueba = {
  email: 'camila@correo.cl',
  nombre: 'Camila',
  activo: true,
  rol: ROLES.CLIENTE,
  aceptaMarketingEmail: true,
  fechaVerificacionCorreo: new Date('2026-10-01T12:00:00.000Z'),
  fechaNacimiento: new Date('1990-11-05T00:00:00.000Z'),
};

const crear = (
  opciones: {
    cuenta?: Partial<CuentaPrueba> | null;
    saludosDelAnio?: number;
    configurado?: { id: number; asunto: string } | null;
  } = {},
) => {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 20 }]),
    usuario: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opciones.cuenta === null ? null : { ...CUENTA, ...opciones.cuenta },
        ),
    },
    notificacion: {
      count: vi.fn().mockResolvedValue(opciones.saludosDelAnio ?? 0),
      create: vi.fn().mockResolvedValue({ id: 70 }),
    },
    campana: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          opciones.configurado === undefined
            ? { id: 4, asunto: '¡Feliz cumpleaños!' }
            : opciones.configurado,
        ),
    },
  };
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 20, codigoPublico: CODIGO }]),
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const correos = { add: vi.fn().mockResolvedValue({}) };
  const servicio = new SaludosCumpleanosService(
    prisma as unknown as PrismaService,
    correos as unknown as Queue,
  );
  return { prisma, tx, correos, servicio };
};

/** Los valores interpolados en la consulta de cuentas candidatas. */
const valoresDeLaBusqueda = (prisma: { $queryRaw: ReturnType<typeof vi.fn> }) =>
  (prisma.$queryRaw.mock.calls[0] as unknown[]).slice(1);

describe('SaludosCumpleanosService', () => {
  it('E12-H5 · CA1 saludo enviado: busca cuentas cliente o profesional que aceptan publicidad, con fecha, de cumpleaños hoy en Chile y sin saludo este año', async () => {
    const { prisma, servicio } = crear();

    await servicio.enviarSaludos(AHORA);

    const [consulta] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray];
    const sql = consulta.join('?');
    expect(sql).toContain('u.acepta_marketing_email');
    expect(sql).toContain('u.fecha_verificacion_correo IS NOT NULL');
    expect(sql).toContain('u.fecha_nacimiento IS NOT NULL');
    expect(sql).toContain('NOT EXISTS');
    expect(valoresDeLaBusqueda(prisma)).toEqual(
      expect.arrayContaining([
        [ROLES.CLIENTE, ROLES.PROFESIONAL],
        ['11-05'],
        TIPOS_NOTIFICACION.CUMPLEANOS,
        // 1 de enero de 2026 a las 0:00 en Chile
        new Date('2026-01-01T03:00:00.000Z'),
      ]),
    );
  });

  it('E12-H5 · CA1 saludo enviado: con la cuenta bloqueada crea la NOTIFICACION con la campaña configurada y la encola después, con prioridad de publicidad', async () => {
    const { prisma, tx, correos, servicio } = crear();

    await servicio.enviarSaludos(AHORA);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // La cuenta se bloquea antes de decidir
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.notificacion.create).toHaveBeenCalledWith({
      data: {
        usuarioId: 20,
        campanaId: 4,
        tipo: TIPOS_NOTIFICACION.CUMPLEANOS,
        asunto: '¡Feliz cumpleaños!',
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
      },
      select: { id: true },
    });
    expect(correos.add).toHaveBeenCalledWith(
      TRABAJOS_CORREO.CUMPLEANOS,
      {
        notificacionId: 70,
        destinatario: 'camila@correo.cl',
        nombre: 'Camila',
      },
      expect.objectContaining({ priority: PRIORIDAD_CORREO.PUBLICIDAD }),
    );
  });

  it('E12-H5 · CA1 saludo enviado: sin configurar, sale con el asunto por defecto y sin campaña', async () => {
    const { tx, servicio } = crear({ configurado: null });

    await servicio.enviarSaludos(AHORA);

    expect(tx.notificacion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campanaId: null,
          asunto: ASUNTO_CUMPLEANOS_POR_DEFECTO,
        }) as object,
      }),
    );
  });

  it('E12-H5 · CA1 una sola vez en el año: si ya tiene el saludo de este año en Chile, no crea otro', async () => {
    const { tx, correos, servicio } = crear({ saludosDelAnio: 1 });

    await servicio.enviarSaludos(AHORA);

    expect(tx.notificacion.count).toHaveBeenCalledWith({
      where: {
        usuarioId: 20,
        tipo: TIPOS_NOTIFICACION.CUMPLEANOS,
        fechaCreacion: { gte: new Date('2026-01-01T03:00:00.000Z') },
      },
    });
    expect(tx.notificacion.create).not.toHaveBeenCalled();
    expect(correos.add).not.toHaveBeenCalled();
  });

  it('E12-H5 · CA1 saludo enviado: antes de las 9:00 de Chile no busca a nadie', async () => {
    const { prisma, servicio } = crear();

    await servicio.enviarSaludos(new Date('2026-11-05T11:59:00.000Z'));

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it.each([
    ['ya no tiene fecha de nacimiento', { fechaNacimiento: null }],
    ['dejó de aceptar publicidad', { aceptaMarketingEmail: false }],
    ['pasó a ser del personal', { rol: ROLES.VENDEDOR }],
    [
      'cambió su fecha y hoy no está de cumpleaños',
      { fechaNacimiento: new Date('1990-12-24T00:00:00.000Z') },
    ],
  ])(
    'E12-H5 · CA3 sin fecha o sin consentimiento: si con la cuenta bloqueada %s, no envía el saludo',
    async (_caso, cuenta) => {
      const { tx, correos, servicio } = crear({ cuenta });

      await servicio.enviarSaludos(AHORA);

      expect(tx.notificacion.create).not.toHaveBeenCalled();
      expect(correos.add).not.toHaveBeenCalled();
    },
  );

  it('E12-H5 · una falla con una cuenta no detiene la pasada ni deja nada a medias', async () => {
    const { prisma, correos, servicio } = crear();
    prisma.$transaction.mockRejectedValue(new Error('base caída'));

    await expect(servicio.enviarSaludos(AHORA)).resolves.toBeUndefined();
    expect(correos.add).not.toHaveBeenCalled();
  });

  it('RNF-32 · si Redis no responde al encolar, el saludo queda pendiente en la base para la revisión', async () => {
    const { tx, correos, servicio } = crear();
    correos.add.mockRejectedValue(new Error('Redis caído'));

    await expect(servicio.enviarSaludos(AHORA)).resolves.toBeUndefined();
    expect(tx.notificacion.create).toHaveBeenCalledTimes(1);
  });
});
