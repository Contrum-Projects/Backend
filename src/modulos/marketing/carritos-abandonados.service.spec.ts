import type { Queue } from 'bullmq';
import { TRABAJOS_CORREO } from '../../colas/colas.js';
import { ROLES } from '../../common/dominio/roles.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CarritoService } from '../carrito/carrito.service.js';
import {
  ASUNTO_RECORDATORIO_CARRITO,
  CarritosAbandonadosService,
} from './carritos-abandonados.service.js';

const HORA = 60 * 60 * 1000;
/** Miércoles 4 de noviembre de 2026, 12:00 en Chile. */
const CAMBIO = new Date('2026-11-04T15:00:00.000Z');
const mas = (horas: number) => new Date(CAMBIO.getTime() + horas * HORA);
const CODIGO = '6f1c1b1e-0000-4000-8000-000000000001';

interface EstadoCarrito {
  fechaActualizacion: Date;
  fechaRecordatorio: Date | null;
  recordatoriosEnviados: number;
}

const SIN_SERIE: EstadoCarrito = {
  fechaActualizacion: CAMBIO,
  fechaRecordatorio: null,
  recordatoriosEnviados: 0,
};

const DUENO = {
  id: 20,
  email: 'camila@correo.cl',
  nombre: 'Camila',
  activo: true,
  rol: ROLES.CLIENTE,
  aceptaMarketingEmail: true,
  fechaVerificacionCorreo: new Date('2026-10-01T12:00:00.000Z'),
};

const crear = (
  enLista: EstadoCarrito,
  bloqueado: (EstadoCarrito & { items?: number; dueno?: object }) | null = {
    ...enLista,
  },
) => {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: DUENO.id }]),
    carrito: {
      findUnique: vi.fn().mockResolvedValue(
        bloqueado && {
          fechaActualizacion: bloqueado.fechaActualizacion,
          fechaRecordatorio: bloqueado.fechaRecordatorio,
          recordatoriosEnviados: bloqueado.recordatoriosEnviados,
          items: Array.from({ length: bloqueado.items ?? 2 }, (_, i) => ({
            articuloId: 100 + i,
          })),
          usuario: { ...DUENO, ...bloqueado.dueno },
        },
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    notificacion: { create: vi.fn().mockResolvedValue({ id: 55 }) },
  };
  const prisma = {
    carrito: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: 3, ...enLista, usuario: { codigoPublico: CODIGO } },
        ]),
    },
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const correos = { add: vi.fn().mockResolvedValue({}) };
  const carritoService = {
    articulosALaVenta: vi.fn(
      (_tx: unknown, ids: number[]) =>
        new Map(ids.map((id) => [id, { tipo: 'formato' }])),
    ),
  };
  const servicio = new CarritosAbandonadosService(
    prisma as unknown as PrismaService,
    correos as unknown as Queue,
    carritoService as unknown as CarritoService,
  );
  return { prisma, tx, correos, carritoService, servicio };
};

describe('CarritosAbandonadosService', () => {
  it('E12-H4 · CA1 serie de recordatorios: busca solo carritos con artículos de dueños que aceptan publicidad y verificaron su correo', async () => {
    const { prisma, servicio } = crear(SIN_SERIE);

    await servicio.enviarRecordatorios(mas(1));

    const { where } = prisma.carrito.findMany.mock.calls[0][0];
    expect(where).toMatchObject({
      items: { some: {} },
      usuario: {
        activo: true,
        rol: { in: [ROLES.CLIENTE, ROLES.PROFESIONAL] },
        aceptaMarketingEmail: true,
        fechaVerificacionCorreo: { not: null },
      },
      fechaActualizacion: { gt: mas(-95), lte: CAMBIO },
    });
  });

  it('E12-H4 · CA1 serie de recordatorios: a la hora registra el abandono en el carrito y la NOTIFICACION en la misma transacción, y encola después', async () => {
    const { prisma, tx, correos, servicio } = crear(SIN_SERIE);
    const ahora = mas(1);

    await servicio.enviarRecordatorios(ahora);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Con la cuenta bloqueada, como los cambios del carrito
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.carrito.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: {
        recordatoriosEnviados: 1,
        fechaRecordatorio: ahora,
        fechaActualizacion: CAMBIO,
      },
    });
    expect(tx.notificacion.create).toHaveBeenCalledWith({
      data: {
        usuarioId: DUENO.id,
        tipo: TIPOS_NOTIFICACION.RECORDATORIO_CARRITO,
        asunto: ASUNTO_RECORDATORIO_CARRITO,
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
      },
      select: { id: true },
    });
    expect(correos.add).toHaveBeenCalledWith(
      TRABAJOS_CORREO.RECORDATORIO_CARRITO,
      { notificacionId: 55, destinatario: DUENO.email, nombre: DUENO.nombre },
      expect.objectContaining({ jobId: 'correo-55', priority: 10 }),
    );
    // El encolado va después del commit
    expect(correos.add.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.notificacion.create.mock.invocationCallOrder[0],
    );
  });

  it('E12-H4 · CA1 serie de recordatorios: el segundo y el tercero siguen la serie sin cambiar su inicio', async () => {
    const enCurso: EstadoCarrito = {
      fechaActualizacion: CAMBIO,
      fechaRecordatorio: mas(1),
      recordatoriosEnviados: 1,
    };
    const { tx, servicio } = crear(enCurso);

    await servicio.enviarRecordatorios(mas(24));

    expect(tx.carrito.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { recordatoriosEnviados: 2, fechaActualizacion: CAMBIO },
    });
  });

  it('E12-H4 · CA1 serie de recordatorios: sin plazo vencido no abre transacción ni envía', async () => {
    const enCurso: EstadoCarrito = {
      fechaActualizacion: CAMBIO,
      fechaRecordatorio: mas(1),
      recordatoriosEnviados: 1,
    };
    const { prisma, correos, servicio } = crear(enCurso);

    await servicio.enviarRecordatorios(mas(10));

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(correos.add).not.toHaveBeenCalled();
  });

  it('E12-H4 · CA1 serie de recordatorios: si dejó de aceptar publicidad antes de bloquear, no envía', async () => {
    const { tx, correos, servicio } = crear(SIN_SERIE, {
      ...SIN_SERIE,
      dueno: { aceptaMarketingEmail: false },
    });

    await servicio.enviarRecordatorios(mas(1));

    expect(tx.notificacion.create).not.toHaveBeenCalled();
    expect(correos.add).not.toHaveBeenCalled();
  });

  it('E12-H4 · RNF-04 · si ningún artículo del carrito sigue a la venta para su rol (por ejemplo, pasó a exclusivo), no envía', async () => {
    const { tx, correos, carritoService, servicio } = crear(SIN_SERIE);
    carritoService.articulosALaVenta.mockReturnValue(new Map());

    await servicio.enviarRecordatorios(mas(1));

    expect(carritoService.articulosALaVenta).toHaveBeenCalledWith(
      tx,
      [100, 101],
      ROLES.CLIENTE,
    );
    expect(tx.carrito.update).not.toHaveBeenCalled();
    expect(tx.notificacion.create).not.toHaveBeenCalled();
    expect(correos.add).not.toHaveBeenCalled();
  });

  it('E12-H4 · CA2 compra o cambio del carrito: si lo modificó mientras se revisaba, con la cuenta bloqueada ya no envía', async () => {
    const { tx, correos, servicio } = crear(SIN_SERIE, {
      ...SIN_SERIE,
      fechaActualizacion: mas(0.99),
    });

    await servicio.enviarRecordatorios(mas(1));

    expect(tx.carrito.update).not.toHaveBeenCalled();
    expect(tx.notificacion.create).not.toHaveBeenCalled();
    expect(correos.add).not.toHaveBeenCalled();
  });

  it('E12-H4 · CA2 compra o cambio del carrito: si compró y el carrito quedó vacío, no envía', async () => {
    const { tx, correos, servicio } = crear(SIN_SERIE, {
      ...SIN_SERIE,
      items: 0,
    });

    await servicio.enviarRecordatorios(mas(1));

    expect(tx.notificacion.create).not.toHaveBeenCalled();
    expect(correos.add).not.toHaveBeenCalled();
  });

  it('E12-H4 · CA3 una serie por semana: otro abandono en la misma semana no abre transacción ni envía', async () => {
    const otroAbandono: EstadoCarrito = {
      fechaActualizacion: mas(30),
      fechaRecordatorio: mas(1),
      recordatoriosEnviados: 1,
    };
    const { prisma, correos, servicio } = crear(otroAbandono);

    await servicio.enviarRecordatorios(mas(31));

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(correos.add).not.toHaveBeenCalled();
  });

  it('E12-H4 · RNF-32 · si Redis no responde, el recordatorio queda pendiente en la base y la tarea sigue', async () => {
    const { tx, correos, servicio } = crear(SIN_SERIE);
    correos.add.mockRejectedValue(new Error('Redis caído'));

    await expect(servicio.enviarRecordatorios(mas(1))).resolves.toBeUndefined();
    expect(tx.notificacion.create).toHaveBeenCalledTimes(1);
  });

  it('E12-H4 · una falla con un carrito no corta la pasada', async () => {
    const { prisma, servicio } = crear(SIN_SERIE);
    prisma.carrito.findMany.mockResolvedValue([
      { id: 3, ...SIN_SERIE, usuario: { codigoPublico: CODIGO } },
      { id: 4, ...SIN_SERIE, usuario: { codigoPublico: CODIGO } },
    ]);
    prisma.$transaction.mockRejectedValueOnce(new Error('base caída'));

    await servicio.enviarRecordatorios(mas(1));

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
