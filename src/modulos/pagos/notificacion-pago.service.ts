import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import {
  InvalidWebhookSignatureError,
  WebhookSignatureValidator,
} from 'mercadopago';
import {
  COLAS,
  TRABAJOS_EVENTO_PAGO,
  type TrabajoProcesarEventoPago,
} from '../../colas/colas.js';
import { conPlazoDeCola } from '../../colas/encolar-correo.js';
import {
  ESTADOS_EVENTO_PAGO,
  type Valor,
} from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  AplicarPagoService,
  PAGO_NO_CORRESPONDE,
} from './aplicar-pago.service.js';
import { PasarelaPago } from './pasarela-pago.js';

export const FIRMA_INVALIDA = 'La firma de la notificación no es válida.';
export const NOTIFICACION_INVALIDA = 'La notificación no es válida.';
export const NOTIFICACIONES_NO_CONFIGURADAS =
  'Las notificaciones de Mercado Pago no están configuradas.';

/** Veces que se intenta procesar un evento; después lo revisa una persona (E6-H3). */
export const INTENTOS_EVENTO_PAGO = 5;

const TIPO_PAGO = 'payment';
/** Ids de pago de Mercado Pago: solo dígitos, como en el regreso del comprador. */
const FORMATO_ID_PAGO = /^\d{1,20}$/;
/** Largo de EVENTO_PAGO.id_evento_externo. */
const LARGO_ID_EVENTO = 100;
const LARGO_ACCION = 50;
/** Un evento recién recibido ya está en la cola: la revisión solo mira los más antiguos. */
const ANTIGUEDAD_REVISION_MS = 60_000;
const LOTE_REVISION = 100;

// El estado vive en EVENTO_PAGO: el trabajo se borra al terminar y la revisión puede reencolarlo
const OPCIONES_TRABAJO = {
  attempts: INTENTOS_EVENTO_PAGO,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: true,
} as const;

/** Lo que trae la petición de Mercado Pago, sin validar. */
export interface NotificacionRecibida {
  firma: unknown;
  idSolicitud: unknown;
  /** `data.id` de la URL: es el que va firmado. */
  idPago: unknown;
  tipo: unknown;
  cuerpo: unknown;
}

/** Lo que se guarda de la notificación: solo estos campos, sin datos del comprador. */
interface ContenidoNotificacion {
  id: string;
  tipo: string;
  accion: string | null;
  idPago: string;
}

const textoDe = (valor: unknown): string | undefined =>
  typeof valor === 'string' ? valor : undefined;

const campoDe = (cuerpo: unknown, campo: string): unknown =>
  typeof cuerpo === 'object' && cuerpo !== null
    ? (cuerpo as Record<string, unknown>)[campo]
    : undefined;

/** El id de la notificación en el cuerpo: Mercado Pago lo envía como número o como texto. */
const idDeEvento = (cuerpo: unknown): string | undefined => {
  const id = campoDe(cuerpo, 'id');
  const texto = typeof id === 'number' ? String(id) : textoDe(id);
  return texto && texto.length <= LARGO_ID_EVENTO ? texto : undefined;
};

/**
 * Notificaciones de pago de Mercado Pago (E6-H2, RF-06.02, RF-06.03, RF-06.06). Se reciben y
 * responden de inmediato (RNF-15) y se procesan en la cola `eventos-pago`. Solo se confía en la
 * firma para saber que avisó Mercado Pago: el estado del pago siempre se le consulta.
 */
@Injectable()
export class NotificacionPagoService {
  private readonly logger = new Logger(NotificacionPagoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
    private readonly pasarela: PasarelaPago,
    private readonly aplicarPago: AplicarPagoService,
    @InjectQueue(COLAS.EVENTOS_PAGO) private readonly eventos: Queue,
  ) {}

  /**
   * E6-H2 · Valida la firma, guarda el evento y lo encola. Sin firma válida no se toca nada. Un
   * evento ya guardado no se duplica (`idEventoExterno` único) y, si ya terminó, se ignora.
   */
  async recibir(notificacion: NotificacionRecibida): Promise<void> {
    this.validarFirma(notificacion);

    const tipo =
      textoDe(notificacion.tipo) ?? campoDe(notificacion.cuerpo, 'type');
    // Mercado Pago solo espera el 200: otros tipos de aviso no le interesan a la tienda
    if (tipo !== TIPO_PAGO) return;

    const idPago = textoDe(notificacion.idPago);
    const idEvento = idDeEvento(notificacion.cuerpo);
    if (!idPago || !FORMATO_ID_PAGO.test(idPago) || !idEvento) {
      throw new BadRequestException(NOTIFICACION_INVALIDA);
    }

    const accion = textoDe(campoDe(notificacion.cuerpo, 'action'));
    const contenido: ContenidoNotificacion = {
      id: idEvento,
      tipo,
      accion: accion?.slice(0, LARGO_ACCION) ?? null,
      idPago,
    };
    await this.prisma.eventoPago.createMany({
      data: {
        idEventoExterno: idEvento,
        tipoEvento: tipo,
        estadoProcesamiento: ESTADOS_EVENTO_PAGO.PENDIENTE,
        contenidoRecibido: JSON.stringify(contenido),
      },
      skipDuplicates: true,
    });
    const evento = await this.prisma.eventoPago.findUniqueOrThrow({
      where: { idEventoExterno: idEvento },
      select: { id: true, estadoProcesamiento: true },
    });
    if (evento.estadoProcesamiento !== ESTADOS_EVENTO_PAGO.PENDIENTE) return;

    await this.encolar(evento.id);
  }

  /**
   * E6-H2 · Lo hace el worker: consulta el pago a Mercado Pago y lo aplica. Si Mercado Pago no
   * responde o aún no conoce el pago, lanza el error para que BullMQ reintente. Lo que
   * reintentar no arregla queda `descartado` si no es de esta tienda y, si hay un pago aprobado
   * sin aplicar, en `revision_manual` (E6-H3).
   */
  async procesar(eventoId: number): Promise<void> {
    const reservado = await this.prisma.eventoPago.updateMany({
      where: {
        id: eventoId,
        estadoProcesamiento: ESTADOS_EVENTO_PAGO.PENDIENTE,
        intentos: { lt: INTENTOS_EVENTO_PAGO },
      },
      data: { intentos: { increment: 1 } },
    });
    if (reservado.count === 0) return;

    const evento = await this.prisma.eventoPago.findUniqueOrThrow({
      where: { id: eventoId },
      select: { contenidoRecibido: true },
    });
    const { idPago } = JSON.parse(
      evento.contenidoRecibido ?? '{}',
    ) as ContenidoNotificacion;

    const pago = await this.pasarela.consultarPago(idPago);
    if (!pago) throw new Error('Mercado Pago aún no conoce el pago.');

    let estado: Valor<typeof ESTADOS_EVENTO_PAGO> =
      ESTADOS_EVENTO_PAGO.PROCESADO;
    try {
      await this.aplicarPago.aplicar(pago);
    } catch (error) {
      if (
        !(error instanceof BadRequestException) &&
        !(error instanceof ConflictException)
      ) {
        throw error;
      }
      // AplicarPagoService solo responde otra cosa ante un pago aprobado: Mercado Pago ya cobró
      estado =
        error.message === PAGO_NO_CORRESPONDE
          ? ESTADOS_EVENTO_PAGO.DESCARTADO
          : ESTADOS_EVENTO_PAGO.REVISION_MANUAL;
      this.logger.warn(
        `Evento de pago ${eventoId} en ${estado} (pago ${pago.idExterno}): ${error.message}`,
      );
    }

    const registrado = await this.prisma.pago.findUnique({
      where: { idTransaccionExterna: pago.idExterno },
      select: { id: true },
    });
    await this.prisma.eventoPago.update({
      where: { id: eventoId },
      data: {
        estadoProcesamiento: estado,
        fechaProcesamiento: new Date(),
        pagoId: registrado?.id ?? null,
      },
    });
  }

  /**
   * E6-H2 · Tarea periódica: vuelve a encolar los eventos que siguen pendientes porque Redis se
   * cayó o se vació después de responderle a Mercado Pago (RNF-29). El id del trabajo evita
   * duplicar los que siguen en la cola. E6-H3 · Los que agotaron los reintentos quedan para que
   * los revise una persona; si el último intento aún corre y termina bien, deja su estado final.
   */
  async revisarPendientes(): Promise<void> {
    const agotados = await this.prisma.eventoPago.updateMany({
      where: {
        estadoProcesamiento: ESTADOS_EVENTO_PAGO.PENDIENTE,
        intentos: { gte: INTENTOS_EVENTO_PAGO },
      },
      data: { estadoProcesamiento: ESTADOS_EVENTO_PAGO.REVISION_MANUAL },
    });
    if (agotados.count > 0) {
      this.logger.warn(
        `${agotados.count} evento(s) de pago agotaron los reintentos: quedan para revisión.`,
      );
    }

    const pendientes = await this.prisma.eventoPago.findMany({
      where: {
        estadoProcesamiento: ESTADOS_EVENTO_PAGO.PENDIENTE,
        intentos: { lt: INTENTOS_EVENTO_PAGO },
        fechaRecepcion: { lt: new Date(Date.now() - ANTIGUEDAD_REVISION_MS) },
      },
      orderBy: { id: 'asc' },
      take: LOTE_REVISION,
      select: { id: true },
    });
    for (const { id } of pendientes) await this.encolar(id);
  }

  private validarFirma({ firma, idSolicitud, idPago }: NotificacionRecibida) {
    const secreto = this.config.get('MERCADOPAGO_WEBHOOK_SECRET', {
      infer: true,
    });
    if (!secreto) {
      // Nunca se acepta sin firma; con 503, Mercado Pago reintenta cuando ya esté configurado
      this.logger.error('Falta MERCADOPAGO_WEBHOOK_SECRET.');
      throw new ServiceUnavailableException(NOTIFICACIONES_NO_CONFIGURADAS);
    }
    // El manifiesto omite los datos que faltan: sin id firmado no se acepta la notificación
    const dataId = textoDe(idPago);
    if (!dataId) throw new UnauthorizedException(FIRMA_INVALIDA);
    try {
      WebhookSignatureValidator.validate({
        xSignature: textoDe(firma),
        xRequestId: textoDe(idSolicitud),
        // Mercado Pago firma el id en minúsculas si es alfanumérico
        dataId: dataId.toLowerCase(),
        secret: secreto,
      });
    } catch (error) {
      if (!(error instanceof InvalidWebhookSignatureError)) throw error;
      this.logger.warn(`Notificación de pago rechazada: ${error.reason}`);
      throw new UnauthorizedException(FIRMA_INVALIDA);
    }
  }

  // Con Redis caído el evento ya está guardado: la revisión periódica lo reencola (RNF-32)
  private async encolar(eventoId: number): Promise<void> {
    const datos: TrabajoProcesarEventoPago = { eventoId };
    try {
      await conPlazoDeCola(
        this.eventos.add(TRABAJOS_EVENTO_PAGO.PROCESAR, datos, {
          ...OPCIONES_TRABAJO,
          jobId: `evento-${eventoId}`,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo encolar el evento de pago ${eventoId}: ${(error as Error).message}`,
      );
    }
  }
}
