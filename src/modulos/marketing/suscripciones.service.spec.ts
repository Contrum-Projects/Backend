import { BadRequestException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { TRABAJOS_CORREO } from '../../colas/colas.js';
import {
  ESTADOS_NOTIFICACION,
  ORIGENES_LEAD,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { FirmaSuscripcion } from './firma-suscripcion.js';
import {
  ASUNTO_CONFIRMACION_SUSCRIPCION,
  MENSAJE_SUSCRIPCION,
  MENSAJE_SUSCRIPCION_CONFIRMADA,
  SuscripcionesService,
} from './suscripciones.service.js';

const CONFIG: Record<string, unknown> = {
  JWT_ACCESS_SECRET: 's'.repeat(32),
  CONFIRMACION_CORREO_HORAS: 24,
  URL_TIENDA: 'https://tienda.cl',
};
const EMAIL = 'camila@correo.cl';

describe('SuscripcionesService', () => {
  let tx: {
    $queryRaw: ReturnType<typeof vi.fn>;
    lead: { upsert: ReturnType<typeof vi.fn> };
    notificacion: {
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
  let prisma: {
    lead: {
      updateMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let cola: { add: ReturnType<typeof vi.fn> };
  let firma: FirmaSuscripcion;
  let servicio: SuscripcionesService;

  beforeEach(() => {
    tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id_lead: 4 }]),
      lead: { upsert: vi.fn().mockResolvedValue({ id: 4, activo: false }) },
      notificacion: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: 9 }),
      },
    };
    prisma = {
      lead: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    cola = { add: vi.fn().mockResolvedValue({}) };
    firma = new FirmaSuscripcion({
      get: (clave: string) => CONFIG[clave],
    } as unknown as ConfigService<Entorno, true>);
    servicio = new SuscripcionesService(
      prisma as unknown as PrismaService,
      firma,
      cola as unknown as Queue,
    );
  });

  describe('suscribir', () => {
    it('E12-H1 · solicitud de suscripción: registra la suscripción inactiva y la notificación en una transacción', async () => {
      const respuesta = await servicio.suscribir(EMAIL);

      expect(respuesta).toEqual({ mensaje: MENSAJE_SUSCRIPCION });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.lead.upsert).toHaveBeenCalledWith({
        where: { email: EMAIL },
        create: {
          email: EMAIL,
          origen: ORIGENES_LEAD.FORMULARIO_WEB,
          activo: false,
        },
        update: {},
        select: { id: true, activo: true },
      });
      expect(tx.notificacion.create).toHaveBeenCalledWith({
        data: {
          leadId: 4,
          tipo: TIPOS_NOTIFICACION.CONFIRMACION_SUSCRIPCION,
          asunto: ASUNTO_CONFIRMACION_SUSCRIPCION,
          estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
          fechaCreacion: expect.any(Date) as Date,
        },
        select: { id: true },
      });
    });

    it('E12-H1 · solicitud de suscripción: encola después del commit el correo con el enlace firmado y prioridad de suscripción', async () => {
      await servicio.suscribir(EMAIL);

      expect(cola.add).toHaveBeenCalledTimes(1);
      const [nombre, datos, opciones] = cola.add.mock.calls[0];
      expect(nombre).toBe(TRABAJOS_CORREO.CONFIRMACION_SUSCRIPCION);
      expect(opciones).toMatchObject({
        jobId: 'correo-9',
        priority: 5,
        removeOnComplete: true,
        removeOnFail: true,
      });
      expect(datos.notificacionId).toBe(9);
      expect(datos.destinatario).toBe(EMAIL);
      // La emisión del enlace es la fecha de la notificación: la revisión lo rearma igual
      const { fechaCreacion } = tx.notificacion.create.mock.calls[0][0].data;
      expect(datos.enlace).toBe(firma.enlace(EMAIL, fechaCreacion).enlace);
      const token = new URL(datos.enlace).searchParams.get('token')!;
      expect(firma.verificar(token)).toEqual({
        email: EMAIL,
        emitido: fechaCreacion,
      });
    });

    it('E12-H1 · solicitud de suscripción: si el correo ya está confirmado responde lo mismo y no envía nada', async () => {
      tx.lead.upsert.mockResolvedValue({ id: 4, activo: true });

      const respuesta = await servicio.suscribir(EMAIL);

      expect(respuesta).toEqual({ mensaje: MENSAJE_SUSCRIPCION });
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.notificacion.create).not.toHaveBeenCalled();
      expect(cola.add).not.toHaveBeenCalled();
    });

    it('E12-H1 · solicitud de suscripción: pendiente o dada de baja, reenvía la confirmación sin activar ni tocar el lead', async () => {
      tx.lead.upsert.mockResolvedValue({ id: 4, activo: false });

      await servicio.suscribir(EMAIL);

      // `update: {}`: la baja no se deshace hasta confirmar
      expect(tx.lead.upsert.mock.calls[0][0].update).toEqual({});
      expect(cola.add).toHaveBeenCalledTimes(1);
    });

    it('E12-H1 · RNF-09: con una confirmación enviada hace menos de 15 minutos responde igual y no envía otra', async () => {
      tx.notificacion.count.mockResolvedValue(1);

      const respuesta = await servicio.suscribir(EMAIL);

      expect(respuesta).toEqual({ mensaje: MENSAJE_SUSCRIPCION });
      expect(tx.notificacion.create).not.toHaveBeenCalled();
      expect(cola.add).not.toHaveBeenCalled();
    });

    it('E12-H1 · RNF-09: el tope por dirección bloquea la fila del lead y cuenta las confirmaciones de los últimos 15 minutos', async () => {
      const antes = Date.now();

      await servicio.suscribir(EMAIL);

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      const [sql, id] = tx.$queryRaw.mock.calls[0] as [string[], number];
      expect(sql.join('?')).toMatch(/FROM lead WHERE id_lead = \? FOR UPDATE/);
      expect(id).toBe(4);
      // El bloqueo va antes de contar: una solicitud simultánea ve la notificación de esta
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.notificacion.count.mock.invocationCallOrder[0],
      );
      const { where } = tx.notificacion.count.mock.calls[0][0];
      expect(where.leadId).toBe(4);
      expect(where.tipo).toBe(TIPOS_NOTIFICACION.CONFIRMACION_SUSCRIPCION);
      expect(antes - where.fechaCreacion.gt.getTime()).toBeGreaterThanOrEqual(
        15 * 60_000 - 1_000,
      );
      expect(antes - where.fechaCreacion.gt.getTime()).toBeLessThanOrEqual(
        15 * 60_000,
      );
    });

    it('E12-H1 · solicitud de suscripción: si otra solicitud simultánea creó el lead, reintenta una vez y respeta su tope', async () => {
      const duplicado = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: 'test' },
      );
      tx.lead.upsert.mockRejectedValueOnce(duplicado);
      tx.notificacion.count.mockResolvedValue(1);

      await expect(servicio.suscribir(EMAIL)).resolves.toEqual({
        mensaje: MENSAJE_SUSCRIPCION,
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(tx.notificacion.create).not.toHaveBeenCalled();
      expect(cola.add).not.toHaveBeenCalled();
    });

    it('E12-H1 · solicitud de suscripción: otro error de la base no se reintenta', async () => {
      tx.lead.upsert.mockRejectedValueOnce(new Error('base caída'));

      await expect(servicio.suscribir(EMAIL)).rejects.toThrow('base caída');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('E12-H1 · RNF-32: si Redis no responde, la suscripción queda registrada y responde igual', async () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      cola.add.mockRejectedValue(new Error('Redis caído'));

      await expect(servicio.suscribir(EMAIL)).resolves.toEqual({
        mensaje: MENSAJE_SUSCRIPCION,
      });
      expect(tx.notificacion.create).toHaveBeenCalled();
    });
  });

  describe('confirmar', () => {
    const tokenVigente = (emitido = new Date()) =>
      new URL(firma.enlace(EMAIL, emitido).enlace).searchParams.get('token')!;

    it('E12-H1 · suscripción confirmada: con el enlace firmado activa la suscripción con condición atómica', async () => {
      const emitido = new Date(Date.now() - 60_000);

      const respuesta = await servicio.confirmar(tokenVigente(emitido));

      expect(respuesta).toEqual({ mensaje: MENSAJE_SUSCRIPCION_CONFIRMADA });
      expect(prisma.lead.updateMany).toHaveBeenCalledWith({
        where: {
          email: EMAIL,
          activo: false,
          OR: [{ fechaBaja: null }, { fechaBaja: { lte: emitido } }],
        },
        data: {
          activo: true,
          fechaBaja: null,
          fechaSuscripcion: expect.any(Date) as Date,
        },
      });
    });

    it('E12-H1 · suscripción confirmada: confirmar de nuevo responde lo mismo', async () => {
      prisma.lead.updateMany.mockResolvedValue({ count: 0 });
      prisma.lead.findUnique.mockResolvedValue({ activo: true });

      await expect(servicio.confirmar(tokenVigente())).resolves.toEqual({
        mensaje: MENSAJE_SUSCRIPCION_CONFIRMADA,
      });
    });

    it('E12-H1 · suscripción confirmada: un enlace emitido antes de la baja, o de un correo sin suscripción, responde 400', async () => {
      prisma.lead.updateMany.mockResolvedValue({ count: 0 });
      for (const lead of [{ activo: false }, null]) {
        prisma.lead.findUnique.mockResolvedValue(lead);

        await expect(servicio.confirmar(tokenVigente())).rejects.toThrow(
          BadRequestException,
        );
      }
    });

    it('E12-H1 · suscripción confirmada: un token inventado o vencido responde 400 sin tocar la base', async () => {
      const vencido = firma.firmar(
        EMAIL,
        new Date(Date.now() - 2 * 86_400_000),
        new Date(Date.now() - 86_400_000),
      );

      for (const token of ['inventado', vencido]) {
        await expect(servicio.confirmar(token)).rejects.toThrow(
          'El enlace de confirmación no es válido o ya venció.',
        );
      }
      expect(prisma.lead.updateMany).not.toHaveBeenCalled();
    });
  });
});
