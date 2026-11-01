import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { TRABAJOS_CORREO } from '../../colas/colas.js';
import {
  ESTADOS_NOTIFICACION,
  ESTADOS_PEDIDO,
  TIPOS_NOTIFICACION,
  TIPOS_TOKEN,
} from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { hashearTokenCorreo } from '../cuentas/tokens.js';
import { RevisionCorreosService } from './revision-correos.service.js';

const USUARIO = {
  id: 3,
  codigoPublico: 'uuid-3',
  email: 'camila@correo.cl',
  nombre: 'Camila',
  activo: true,
  fechaVerificacionCorreo: null,
};
const PEDIDO = {
  codigoPublico: 'ABC',
  montoTotal: 1000,
  estadoActual: ESTADOS_PEDIDO.DESPACHADO,
  tipoEntrega: 'despacho',
};

const pendiente = (tipo: string, extra: object = {}) => ({
  id: 7,
  tipo,
  intentos: 0,
  usuario: USUARIO,
  pedido: null,
  ...extra,
});

describe('RevisionCorreosService', () => {
  let tx: {
    $executeRaw: ReturnType<typeof vi.fn>;
    $queryRaw: ReturnType<typeof vi.fn>;
    usuario: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
    notificacion: {
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
    tokenCorreo: {
      findFirst: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
  let prisma: {
    notificacion: {
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let cola: { getJob: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn> };
  let servicio: RevisionCorreosService;

  const correoEncolado = () => cola.add.mock.calls[0];

  beforeEach(() => {
    tx = {
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([{ id_usuario: USUARIO.id }]),
      usuario: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          activo: true,
          fechaVerificacionCorreo: null,
        }),
      },
      notificacion: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      tokenCorreo: {
        findFirst: vi.fn().mockResolvedValue({ id: 50 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma = {
      notificacion: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    cola = {
      getJob: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue({}),
    };
    servicio = new RevisionCorreosService(
      prisma as unknown as PrismaService,
      { get: () => 'https://tienda.cl/' } as unknown as ConfigService<
        Entorno,
        true
      >,
      cola as unknown as Queue,
    );
  });

  const expectFallida = () => {
    expect(prisma.notificacion.updateMany).toHaveBeenCalledWith({
      where: { id: 7, estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE },
      data: { estadoEnvio: ESTADOS_NOTIFICACION.FALLIDA },
    });
    expect(cola.add).not.toHaveBeenCalled();
  };

  it('E1-H6 · correo pendiente: solo busca pendientes que envía este worker y con margen de 2 minutos', async () => {
    await servicio.revisarPendientes();

    const { where } = prisma.notificacion.findMany.mock.calls[0][0];
    expect(where.estadoEnvio).toBe(ESTADOS_NOTIFICACION.PENDIENTE);
    expect(where.tipo.in).toContain(TIPOS_NOTIFICACION.CONFIRMACION_CORREO);
    expect(
      Date.now() - where.fechaCreacion.lt.getTime(),
    ).toBeGreaterThanOrEqual(2 * 60 * 1000);
  });

  it.each([
    [
      TIPOS_NOTIFICACION.CONFIRMACION_CORREO,
      TRABAJOS_CORREO.CONFIRMACION_CORREO,
      TIPOS_TOKEN.CONFIRMACION_CORREO,
      'https://tienda.cl/confirmar-correo?token=',
    ],
    [
      TIPOS_NOTIFICACION.RECUPERACION_CONTRASENA,
      TRABAJOS_CORREO.RECUPERACION_CONTRASENA,
      TIPOS_TOKEN.RECUPERACION_CONTRASENA,
      'https://tienda.cl/restablecer-contrasena?token=',
    ],
    [
      TIPOS_NOTIFICACION.INVITACION_PERSONAL,
      TRABAJOS_CORREO.INVITACION_PERSONAL,
      TIPOS_TOKEN.INVITACION_PERSONAL,
      'https://tienda.cl/personal/activar?token=',
    ],
  ])(
    'E1-H6 · correo pendiente: %s se reencola con un token nuevo, en la misma fila (mismo vencimiento)',
    async (tipo, nombreTrabajo, tipoToken, ruta) => {
      prisma.notificacion.findMany.mockResolvedValue([pendiente(tipo)]);

      await servicio.revisarPendientes();

      expect(tx.tokenCorreo.findFirst.mock.calls[0][0].where.tipo).toBe(
        tipoToken,
      );
      const [nombre, datos, opciones] = correoEncolado();
      expect(nombre).toBe(nombreTrabajo);
      expect(opciones).toMatchObject({
        jobId: 'correo-7',
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: true,
      });
      expect(datos.enlace.startsWith(ruta)).toBe(true);
      const token = decodeURIComponent(datos.enlace.slice(ruta.length));
      // Solo cambia el hash: no toca `fechaExpiracion`, y lo guardado no es el token en claro
      expect(tx.tokenCorreo.updateMany).toHaveBeenCalledWith({
        where: {
          id: 50,
          fechaUso: null,
          fechaExpiracion: { gt: expect.any(Date) as Date },
        },
        data: { tokenHash: hashearTokenCorreo(token) },
      });
    },
  );

  it('E1-H6 · correo pendiente: lo que sigue en la cola no se duplica ni se le cambia el token', async () => {
    prisma.notificacion.findMany.mockResolvedValue([
      pendiente(TIPOS_NOTIFICACION.CONFIRMACION_CORREO),
    ]);
    cola.getJob.mockResolvedValue({ id: 'correo-7' });

    await servicio.revisarPendientes();

    expect(cola.getJob).toHaveBeenCalledWith('correo-7');
    expect(cola.add).not.toHaveBeenCalled();
    expect(tx.tokenCorreo.updateMany).not.toHaveBeenCalled();
    expect(prisma.notificacion.updateMany).not.toHaveBeenCalled();
  });

  it('E1-H6 · correo pendiente: sin un enlace vigente (vencido o usado) queda fallida', async () => {
    prisma.notificacion.findMany.mockResolvedValue([
      pendiente(TIPOS_NOTIFICACION.RECUPERACION_CONTRASENA),
    ]);
    tx.tokenCorreo.findFirst.mockResolvedValue(null);

    await servicio.revisarPendientes();

    expectFallida();
  });

  it('E1-H6 · correo pendiente: con la cuenta desactivada queda fallida', async () => {
    prisma.notificacion.findMany.mockResolvedValue([
      pendiente(TIPOS_NOTIFICACION.INVITACION_PERSONAL),
    ]);
    tx.usuario.findUniqueOrThrow.mockResolvedValue({
      activo: false,
      fechaVerificacionCorreo: null,
    });

    await servicio.revisarPendientes();

    expectFallida();
    expect(tx.tokenCorreo.updateMany).not.toHaveBeenCalled();
  });

  it('E1-H6 · correo pendiente: con el correo ya confirmado, la confirmación queda fallida', async () => {
    prisma.notificacion.findMany.mockResolvedValue([
      pendiente(TIPOS_NOTIFICACION.CONFIRMACION_CORREO),
    ]);
    tx.usuario.findUniqueOrThrow.mockResolvedValue({
      activo: true,
      fechaVerificacionCorreo: new Date(),
    });

    await servicio.revisarPendientes();

    expectFallida();
  });

  it('E1-H6 · correo pendiente: si hay un correo más nuevo del mismo tipo no anula su enlace', async () => {
    prisma.notificacion.findMany.mockResolvedValue([
      pendiente(TIPOS_NOTIFICACION.INVITACION_PERSONAL),
    ]);
    tx.notificacion.findFirst.mockResolvedValue({ id: 8 });

    await servicio.revisarPendientes();

    expectFallida();
    expect(tx.tokenCorreo.updateMany).not.toHaveBeenCalled();
  });

  it('E1-H6 · correo pendiente: si otra instancia ya lo envió no le cambia el token', async () => {
    prisma.notificacion.findMany.mockResolvedValue([
      pendiente(TIPOS_NOTIFICACION.CONFIRMACION_CORREO),
    ]);
    tx.notificacion.findUnique.mockResolvedValue({
      estadoEnvio: ESTADOS_NOTIFICACION.ENVIADA,
    });

    await servicio.revisarPendientes();

    expect(tx.tokenCorreo.updateMany).not.toHaveBeenCalled();
    expect(cola.add).not.toHaveBeenCalled();
  });

  it('E1-H6 · correo pendiente: si el enlace se consumió mientras tanto queda fallida', async () => {
    prisma.notificacion.findMany.mockResolvedValue([
      pendiente(TIPOS_NOTIFICACION.RECUPERACION_CONTRASENA),
    ]);
    tx.tokenCorreo.updateMany.mockResolvedValue({ count: 0 });

    await servicio.revisarPendientes();

    expectFallida();
  });

  it('E1-H6 · correo pendiente: con los intentos agotados y fuera de la cola queda fallida', async () => {
    prisma.notificacion.findMany.mockResolvedValue([
      pendiente(TIPOS_NOTIFICACION.PAGO_CONFIRMADO, {
        intentos: 5,
        pedido: PEDIDO,
      }),
    ]);

    await servicio.revisarPendientes();

    expectFallida();
  });

  it('E6-H2 · correo pendiente: el pago se reencola con los datos del pedido', async () => {
    prisma.notificacion.findMany.mockResolvedValue([
      pendiente(TIPOS_NOTIFICACION.PAGO_CONFIRMADO, { pedido: PEDIDO }),
    ]);

    await servicio.revisarPendientes();

    const [nombre, datos] = correoEncolado();
    expect(nombre).toBe(TRABAJOS_CORREO.PAGO_CONFIRMADO);
    expect(datos).toEqual({
      notificacionId: 7,
      destinatario: USUARIO.email,
      nombre: USUARIO.nombre,
      codigoPedido: 'ABC',
      montoTotal: 1000,
    });
  });

  it('E8-H2 · correo pendiente: el cambio de estado avisa el estado actual del pedido', async () => {
    prisma.notificacion.findMany.mockResolvedValue([
      pendiente(TIPOS_NOTIFICACION.CAMBIO_ESTADO_PEDIDO, { pedido: PEDIDO }),
    ]);

    await servicio.revisarPendientes();

    expect(correoEncolado()[1]).toMatchObject({
      estado: ESTADOS_PEDIDO.DESPACHADO,
      tipoEntrega: 'despacho',
    });
  });

  it('E8-H2 · correo pendiente: si el pedido retrocedió a un estado sin aviso queda fallida', async () => {
    prisma.notificacion.findMany.mockResolvedValue([
      pendiente(TIPOS_NOTIFICACION.CAMBIO_ESTADO_PEDIDO, {
        pedido: { ...PEDIDO, estadoActual: ESTADOS_PEDIDO.EN_PREPARACION },
      }),
    ]);

    await servicio.revisarPendientes();

    expectFallida();
  });

  it('E11-H6 · correo pendiente: el stock bajo se reencola sin cifras, salvo cuenta desactivada', async () => {
    prisma.notificacion.findMany.mockResolvedValue([
      pendiente(TIPOS_NOTIFICACION.STOCK_BAJO),
    ]);

    await servicio.revisarPendientes();

    expect(correoEncolado()[1]).toEqual({
      notificacionId: 7,
      destinatario: USUARIO.email,
      nombre: USUARIO.nombre,
    });

    cola.add.mockClear();
    prisma.notificacion.findMany.mockResolvedValue([
      pendiente(TIPOS_NOTIFICACION.STOCK_BAJO, {
        usuario: { ...USUARIO, activo: false },
      }),
    ]);

    await servicio.revisarPendientes();

    expectFallida();
  });

  it('E1-H6 · RNF-32: si la cola no responde al reencolar, solo se advierte y sigue pendiente', async () => {
    const advertir = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    prisma.notificacion.findMany.mockResolvedValue([
      pendiente(TIPOS_NOTIFICACION.PAGO_CONFIRMADO, { pedido: PEDIDO }),
    ]);
    cola.add.mockRejectedValue(new Error('Redis caído'));

    await expect(servicio.revisarPendientes()).resolves.toBeUndefined();

    expect(advertir).toHaveBeenCalled();
    expect(prisma.notificacion.updateMany).not.toHaveBeenCalled();
    advertir.mockRestore();
  });
});
