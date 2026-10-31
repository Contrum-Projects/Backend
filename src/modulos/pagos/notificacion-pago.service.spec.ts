import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { createHmac } from 'node:crypto';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AplicarPagoService } from './aplicar-pago.service.js';
import {
  FIRMA_INVALIDA,
  INTENTOS_EVENTO_PAGO,
  NOTIFICACION_INVALIDA,
  NotificacionPagoService,
  type NotificacionRecibida,
} from './notificacion-pago.service.js';
import type { PagoPasarela, PasarelaPago } from './pasarela-pago.js';

const SECRETO = 'secreto-de-prueba';
const ID_PAGO = '1234567890';
const ID_SOLICITUD = 'solicitud-1';
const TS = '1704908010';

const firmar = (
  idPago = ID_PAGO,
  idSolicitud = ID_SOLICITUD,
  secreto = SECRETO,
): string => {
  const manifiesto = `id:${idPago};request-id:${idSolicitud};ts:${TS};`;
  const hash = createHmac('sha256', secreto).update(manifiesto).digest('hex');
  return `ts=${TS},v1=${hash}`;
};

const notificacion = (
  datos: Partial<NotificacionRecibida> = {},
): NotificacionRecibida => ({
  firma: firmar(),
  idSolicitud: ID_SOLICITUD,
  idPago: ID_PAGO,
  tipo: 'payment',
  cuerpo: {
    id: 987654,
    type: 'payment',
    action: 'payment.updated',
    live_mode: true,
    data: { id: ID_PAGO },
  },
  ...datos,
});

const pagoMp: PagoPasarela = {
  idExterno: ID_PAGO,
  estado: 'aprobado',
  monto: 23800,
  moneda: 'CLP',
  codigoPedido: 'AB12CD34EF56',
  medioPago: 'visa',
  fechaAprobacion: new Date('2026-10-31T15:00:00Z'),
};

describe('NotificacionPagoService', () => {
  const crearDb = () => ({
    eventoPago: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 7,
        estadoProcesamiento: 'pendiente',
        contenidoRecibido: JSON.stringify({ idPago: ID_PAGO }),
      }),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    pago: { findUnique: vi.fn().mockResolvedValue({ id: 3 }) },
  });

  let db: ReturnType<typeof crearDb>;
  let pasarela: { consultarPago: ReturnType<typeof vi.fn> };
  let aplicarPago: { aplicar: ReturnType<typeof vi.fn> };
  let eventos: { add: ReturnType<typeof vi.fn> };
  let secreto: string | undefined;
  let servicio: NotificacionPagoService;

  beforeEach(() => {
    db = crearDb();
    pasarela = { consultarPago: vi.fn().mockResolvedValue(pagoMp) };
    aplicarPago = { aplicar: vi.fn().mockResolvedValue('aprobado') };
    eventos = { add: vi.fn().mockResolvedValue({}) };
    secreto = SECRETO;
    servicio = new NotificacionPagoService(
      db as unknown as PrismaService,
      {
        get: vi.fn(() => secreto),
      } as unknown as ConfigService<Entorno, true>,
      pasarela as unknown as PasarelaPago,
      aplicarPago as unknown as AplicarPagoService,
      eventos as unknown as Queue,
    );
  });

  describe('recibir', () => {
    it('E6-H2 · notificación recibida: con firma válida guarda el evento pendiente y lo encola', async () => {
      await servicio.recibir(notificacion());

      const { data, skipDuplicates } = db.eventoPago.createMany.mock
        .calls[0][0] as {
        data: { contenidoRecibido: string } & Record<string, unknown>;
        skipDuplicates: boolean;
      };
      expect(skipDuplicates).toBe(true);
      expect(data).toMatchObject({
        idEventoExterno: '987654',
        tipoEvento: 'payment',
        estadoProcesamiento: 'pendiente',
      });
      expect(JSON.parse(data.contenidoRecibido)).toEqual({
        id: '987654',
        tipo: 'payment',
        accion: 'payment.updated',
        idPago: ID_PAGO,
      });
      expect(eventos.add).toHaveBeenCalledWith(
        'procesar-evento',
        { eventoId: 7 },
        expect.objectContaining({ jobId: 'evento-7', attempts: 5 }),
      );
    });

    it('E6-H2 · notificación repetida: si ya se procesó, no la vuelve a encolar', async () => {
      db.eventoPago.findUniqueOrThrow.mockResolvedValue({
        id: 7,
        estadoProcesamiento: 'procesado',
      });

      await servicio.recibir(notificacion());

      expect(eventos.add).not.toHaveBeenCalled();
    });

    it.each([
      ['sin firma', { firma: undefined }],
      ['firma con otro secreto', { firma: firmar(ID_PAGO, ID_SOLICITUD, 'x') }],
      ['firma de otro pago', { idPago: '999' }],
      ['firma de otra solicitud', { idSolicitud: 'solicitud-2' }],
      ['sin el id del pago', { idPago: undefined }],
      ['con el id repetido en la URL', { idPago: [ID_PAGO, '999'] }],
    ])(
      'E6-H2 · firma inválida (%s): la rechaza sin guardar ni encolar',
      async (_caso, datos) => {
        await expect(servicio.recibir(notificacion(datos))).rejects.toThrow(
          new UnauthorizedException(FIRMA_INVALIDA),
        );

        expect(db.eventoPago.createMany).not.toHaveBeenCalled();
        expect(eventos.add).not.toHaveBeenCalled();
      },
    );

    it('E6-H2 · sin el secreto configurado: responde 503 y nunca acepta la notificación', async () => {
      secreto = undefined;

      await expect(servicio.recibir(notificacion())).rejects.toThrow(
        ServiceUnavailableException,
      );

      expect(db.eventoPago.createMany).not.toHaveBeenCalled();
    });

    it('E6-H2 · aviso firmado que no es de un pago: lo acepta sin guardarlo', async () => {
      await servicio.recibir(notificacion({ tipo: 'merchant_order' }));

      expect(db.eventoPago.createMany).not.toHaveBeenCalled();
      expect(eventos.add).not.toHaveBeenCalled();
    });

    it('E6-H2 · sin el tipo en la URL: lo toma del cuerpo', async () => {
      await servicio.recibir(notificacion({ tipo: undefined }));

      expect(db.eventoPago.createMany).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['sin id de la notificación', { cuerpo: { type: 'payment' } }],
      [
        'id de la notificación demasiado largo',
        { cuerpo: { id: 'x'.repeat(101) } },
      ],
      ['id de pago con otro formato', { idPago: 'abc', firma: firmar('abc') }],
    ])(
      'E6-H2 · notificación firmada con datos inválidos (%s): responde 400',
      async (_caso, datos) => {
        await expect(servicio.recibir(notificacion(datos))).rejects.toThrow(
          new BadRequestException(NOTIFICACION_INVALIDA),
        );

        expect(db.eventoPago.createMany).not.toHaveBeenCalled();
      },
    );

    it('E6-H2 · Redis no responde: el evento queda guardado y la notificación no falla (RNF-32)', async () => {
      eventos.add.mockRejectedValue(new Error('Redis caído'));

      await expect(servicio.recibir(notificacion())).resolves.toBeUndefined();

      expect(db.eventoPago.createMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('procesar', () => {
    it('E6-H2 · notificación recibida: consulta el pago a Mercado Pago, lo aplica y marca el evento', async () => {
      await servicio.procesar(7);

      expect(pasarela.consultarPago).toHaveBeenCalledWith(ID_PAGO);
      expect(aplicarPago.aplicar).toHaveBeenCalledWith(pagoMp);
      expect(db.eventoPago.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: {
          estadoProcesamiento: 'procesado',
          fechaProcesamiento: expect.any(Date),
          pagoId: 3,
        },
      });
    });

    it('E6-H2 · notificación repetida: un evento que ya terminó no se vuelve a procesar', async () => {
      db.eventoPago.updateMany.mockResolvedValue({ count: 0 });

      await servicio.procesar(7);

      expect(db.eventoPago.updateMany.mock.calls[0][0].where).toEqual({
        id: 7,
        estadoProcesamiento: 'pendiente',
        intentos: { lt: INTENTOS_EVENTO_PAGO },
      });
      expect(pasarela.consultarPago).not.toHaveBeenCalled();
      expect(aplicarPago.aplicar).not.toHaveBeenCalled();
    });

    it.each([
      ['otro monto', new BadRequestException('monto')],
      ['pedido cancelado', new ConflictException('cancelado')],
    ])(
      'E6-H2 · pago que no se puede aplicar (%s): queda descartado y no se reintenta',
      async (_caso, error) => {
        aplicarPago.aplicar.mockRejectedValue(error);

        await expect(servicio.procesar(7)).resolves.toBeUndefined();

        expect(
          db.eventoPago.update.mock.calls[0][0].data.estadoProcesamiento,
        ).toBe('descartado');
      },
    );

    it('E6-H2 · Mercado Pago no responde o aún no conoce el pago: lanza el error para reintentar', async () => {
      pasarela.consultarPago.mockRejectedValueOnce(
        new ServiceUnavailableException(),
      );
      await expect(servicio.procesar(7)).rejects.toThrow(
        ServiceUnavailableException,
      );

      pasarela.consultarPago.mockResolvedValueOnce(null);
      await expect(servicio.procesar(7)).rejects.toThrow();

      expect(db.eventoPago.update).not.toHaveBeenCalled();
    });

    it('E6-H2 · falla inesperada al aplicar: lanza el error y el evento sigue pendiente', async () => {
      aplicarPago.aplicar.mockRejectedValue(new Error('base caída'));

      await expect(servicio.procesar(7)).rejects.toThrow('base caída');

      expect(db.eventoPago.update).not.toHaveBeenCalled();
    });
  });

  describe('revisarPendientes', () => {
    it('E6-H2 · evento pendiente tras una caída de Redis: lo reencola con el mismo id de trabajo', async () => {
      db.eventoPago.findMany.mockResolvedValue([{ id: 7 }, { id: 8 }]);

      await servicio.revisarPendientes();

      expect(db.eventoPago.findMany.mock.calls[0][0].where).toMatchObject({
        estadoProcesamiento: 'pendiente',
        intentos: { lt: INTENTOS_EVENTO_PAGO },
      });
      expect(eventos.add).toHaveBeenCalledTimes(2);
      expect(eventos.add.mock.calls[1][2]).toMatchObject({
        jobId: 'evento-8',
      });
    });
  });
});
