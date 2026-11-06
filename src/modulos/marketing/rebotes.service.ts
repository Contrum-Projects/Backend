import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { ESTADOS_NOTIFICACION } from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ETIQUETA_NOTIFICACION } from '../notificaciones/cliente-correo.js';
import { darDeBajaDireccion } from './baja-direccion.js';

export const FIRMA_REBOTE_INVALIDA = 'La firma del aviso no es válida.';
export const REBOTES_NO_CONFIGURADOS =
  'Los avisos de Resend no están configurados.';

/** El único aviso de Resend que se usa: rechazo permanente del servidor de destino. */
export const EVENTO_REBOTE = 'email.bounced';

const FORMATO_ID = /^[1-9]\d{0,9}$/;
/** Un correo de la tienda va a una sola dirección; más que esto no es un aviso de la tienda. */
const MAXIMO_DIRECCIONES = 50;
const LARGO_CORREO = 254;

/**
 * `resend.webhooks.verify` no llama a la API de Resend: solo valida la firma con el secreto del
 * webhook. Esta clave no se usa, pero el constructor del SDK exige una.
 */
const CLAVE_SIN_USO = 're_solo_verificacion';

/** Lo que llega en la petición de Resend, sin validar. */
export interface AvisoRecibido {
  /** El cuerpo tal como llegó: la firma se calcula sobre esos bytes. */
  cuerpo: Buffer | undefined;
  id: unknown;
  marcaTiempo: unknown;
  firma: unknown;
}

/**
 * Resend solo avisa `email.bounced` con rechazos permanentes; por si algún día manda uno pasajero
 * con el mismo evento, ese no da de baja a nadie.
 */
const TIPO_REBOTE_TRANSITORIO = 'Transient';

interface DatosRebote {
  notificacionId: number | null;
  direcciones: string[];
  /** `bounce.type` de Resend: `Transient` es un rechazo pasajero, que no cuenta. */
  transitorio: boolean;
}

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor);

/** Direcciones en minúsculas, como se guardan las cuentas y las suscripciones. */
const direccionesDe = (para: unknown): string[] => {
  if (!Array.isArray(para)) return [];
  const correos = para
    .filter((valor): valor is string => typeof valor === 'string')
    .map((valor) => valor.trim().toLowerCase())
    .filter((valor) => valor.includes('@') && valor.length <= LARGO_CORREO);
  return [...new Set(correos)].slice(0, MAXIMO_DIRECCIONES);
};

const datosDe = (evento: unknown): DatosRebote => {
  const datos = esObjeto(evento) && esObjeto(evento.data) ? evento.data : {};
  const etiquetas = esObjeto(datos.tags) ? datos.tags : {};
  const id = etiquetas[ETIQUETA_NOTIFICACION];
  const rebote = esObjeto(datos.bounce) ? datos.bounce : {};
  return {
    notificacionId:
      typeof id === 'string' && FORMATO_ID.test(id) ? Number(id) : null,
    direcciones: direccionesDe(datos.to),
    transitorio: rebote.type === TIPO_REBOTE_TRANSITORIO,
  };
};

/** Que la notificación vaya a una de las direcciones del aviso, por su cuenta o su suscripción. */
const esDeAlgunaDireccion = async (
  tx: Prisma.TransactionClient,
  id: number,
  direcciones: string[],
): Promise<boolean> => {
  const notificacion = await tx.notificacion.findUnique({
    where: { id },
    select: {
      usuario: { select: { email: true } },
      lead: { select: { email: true } },
    },
  });
  const email = notificacion?.usuario?.email ?? notificacion?.lead?.email;
  return email !== undefined && direcciones.includes(email);
};

/**
 * Rebotes de los correos (E12-H6 · CA2, decisión del 5 de noviembre de 2026). Resend avisa por
 * webhook con `email.bounced` cuando el servidor de destino rechaza el correo para siempre. Solo
 * se confía en el aviso si su firma es válida (Standard Webhooks, con `svix-*`).
 *
 * Cuenta el rebote de **cualquier** correo, no solo de la publicidad: en una transacción la
 * NOTIFICACION (identificada por la etiqueta `notificacion` que lleva cada envío) queda `rebotada`
 * y su dirección deja de recibir publicidad igual que con la baja desde el correo. La notificación
 * solo cambia si su destinatario está en el aviso: una etiqueta de otro ambiente que comparta la
 * cuenta de Resend (mismo id, otra persona) no la toca. Las direcciones del aviso sí quedan sin
 * publicidad, porque rebotaron. El mismo aviso otra vez deja todo igual.
 */
@Injectable()
export class RebotesService {
  private readonly logger = new Logger(RebotesService.name);
  private readonly webhooks = new Resend(CLAVE_SIN_USO).webhooks;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
  ) {}

  async recibir(aviso: AvisoRecibido): Promise<void> {
    const evento = this.validarFirma(aviso);
    // Resend solo espera el 200: otros avisos no le interesan a la tienda
    if (!esObjeto(evento) || evento.type !== EVENTO_REBOTE) return;

    const { notificacionId, direcciones, transitorio } = datosDe(evento);
    if (transitorio || direcciones.length === 0) return;

    const ahora = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (
        notificacionId !== null &&
        (await esDeAlgunaDireccion(tx, notificacionId, direcciones))
      ) {
        await tx.notificacion.updateMany({
          where: {
            id: notificacionId,
            estadoEnvio: {
              in: [
                ESTADOS_NOTIFICACION.PENDIENTE,
                ESTADOS_NOTIFICACION.ENVIADA,
              ],
            },
          },
          data: { estadoEnvio: ESTADOS_NOTIFICACION.REBOTADA },
        });
      }
      for (const email of direcciones) {
        await darDeBajaDireccion(tx, email, ahora);
      }
    });
    // Sin la dirección: es un dato personal (RNF-02)
    this.logger.log(
      `Rebote registrado${notificacionId === null ? ' sin notificación' : ` de la notificación ${notificacionId}`}.`,
    );
  }

  /** El evento si la firma es válida; sin secreto, 503; con firma inválida, 401. */
  private validarFirma(aviso: AvisoRecibido): unknown {
    const secreto = this.config.get('RESEND_WEBHOOK_SECRET', { infer: true });
    if (!secreto)
      throw new ServiceUnavailableException(REBOTES_NO_CONFIGURADOS);

    const { cuerpo, id, marcaTiempo, firma } = aviso;
    if (
      !cuerpo ||
      typeof id !== 'string' ||
      typeof marcaTiempo !== 'string' ||
      typeof firma !== 'string'
    ) {
      throw new UnauthorizedException(FIRMA_REBOTE_INVALIDA);
    }
    try {
      // También rechaza un aviso de hace más de 5 minutos: no se puede repetir uno capturado
      return this.webhooks.verify({
        payload: cuerpo.toString('utf8'),
        headers: { id, timestamp: marcaTiempo, signature: firma },
        webhookSecret: secreto,
      });
    } catch {
      throw new UnauthorizedException(FIRMA_REBOTE_INVALIDA);
    }
  }
}
