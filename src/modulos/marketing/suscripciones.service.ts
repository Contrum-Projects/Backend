import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoConfirmacionSuscripcion,
} from '../../colas/colas.js';
import { encolarCorreos } from '../../colas/encolar-correo.js';
import {
  ESTADOS_NOTIFICACION,
  ORIGENES_LEAD,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import { Prisma } from '../../generated/prisma/client.js';
import { LIMITE_CONFIRMACION_SUSCRIPCION } from '../../limites/limites.js';
import { bloquearLead } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { FirmaSuscripcion } from './firma-suscripcion.js';

export const ASUNTO_CONFIRMACION_SUSCRIPCION =
  'Confirma tu suscripción a las ofertas';

/**
 * Misma respuesta para todo correo válido (decisión del 3 de noviembre de 2026): no revela si la
 * dirección ya estaba suscrita, pendiente, dada de baja o con cuenta.
 */
export const MENSAJE_SUSCRIPCION =
  'Si tu suscripción aún no está confirmada, te enviamos un correo para confirmarla.';

export const MENSAJE_SUSCRIPCION_CONFIRMADA =
  'Tu suscripción quedó confirmada. Te avisaremos de nuestras ofertas.';

/** La única restricción única que puede chocar al suscribir es LEAD.email. */
const esCorreoDuplicado = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

export interface Mensaje {
  mensaje: string;
}

@Injectable()
export class SuscripcionesService {
  private readonly logger = new Logger(SuscripcionesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firma: FirmaSuscripcion,
    @InjectQueue(COLAS.CORREOS) private readonly correos: Queue,
  ) {}

  /**
   * E12-H1 · Registra la suscripción inactiva y encola el correo de confirmación. Si el correo ya
   * está confirmado no envía nada; si está pendiente o dado de baja reenvía la confirmación sin
   * tocar LEAD (la baja se deshace solo al confirmar), como máximo una cada 15 minutos.
   */
  async suscribir(email: string): Promise<Mensaje> {
    // La misma fecha para la NOTIFICACION y el enlace: la revisión de pendientes lo rearma igual
    const emitido = new Date();

    let notificacionId: number | null;
    try {
      notificacionId = await this.registrar(email, emitido);
    } catch (error) {
      // Con el adaptador de PostgreSQL el upsert no es un ON CONFLICT nativo: si otra solicitud
      // del mismo correo creó LEAD entre la búsqueda y el INSERT, se reintenta una vez y ahora lo
      // encuentra (y respeta el tope de esa otra solicitud)
      if (!esCorreoDuplicado(error)) throw error;
      notificacionId = await this.registrar(email, emitido);
    }

    if (notificacionId === null) return { mensaje: MENSAJE_SUSCRIPCION };

    // Después del commit; si Redis no responde, la revisión de pendientes la reencola (RNF-32).
    // Sin esperar la cola: un correo ya confirmado no debe distinguirse por el tiempo de respuesta.
    // `encolarCorreos` atrapa sus propios errores
    const datos: TrabajoConfirmacionSuscripcion = {
      notificacionId,
      destinatario: email,
      enlace: this.firma.enlace(email, emitido).enlace,
    };
    void encolarCorreos(
      this.correos,
      TRABAJOS_CORREO.CONFIRMACION_SUSCRIPCION,
      [datos],
      this.logger,
    );
    return { mensaje: MENSAJE_SUSCRIPCION };
  }

  /**
   * LEAD + NOTIFICACION en una sola transacción (RNF-12). Devuelve la notificación creada, o
   * `null` si no corresponde enviar (ya confirmado o dentro del tope).
   */
  private registrar(email: string, emitido: Date): Promise<number | null> {
    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.upsert({
        where: { email },
        create: {
          email,
          origen: ORIGENES_LEAD.FORMULARIO_WEB,
          activo: false,
        },
        update: {},
        select: { id: true, activo: true },
      });
      if (lead.activo) return null;

      // Tope por dirección: con la fila bloqueada, una solicitud simultánea espera y ve esta
      await bloquearLead(tx, lead.id);
      const recientes = await tx.notificacion.count({
        where: {
          leadId: lead.id,
          tipo: TIPOS_NOTIFICACION.CONFIRMACION_SUSCRIPCION,
          fechaCreacion: {
            gt: new Date(
              emitido.getTime() - LIMITE_CONFIRMACION_SUSCRIPCION.ventanaMs,
            ),
          },
        },
      });
      if (recientes > 0) return null;

      const notificacion = await tx.notificacion.create({
        data: {
          leadId: lead.id,
          tipo: TIPOS_NOTIFICACION.CONFIRMACION_SUSCRIPCION,
          asunto: ASUNTO_CONFIRMACION_SUSCRIPCION,
          estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
          fechaCreacion: emitido,
        },
        select: { id: true },
      });
      return notificacion.id;
    });
  }

  /**
   * E12-H1 · Activa la suscripción con el enlace firmado. Un enlace emitido antes de una baja ya
   * no la deshace. Confirmar dos veces responde lo mismo.
   */
  async confirmar(token: string): Promise<Mensaje> {
    const datos = this.firma.verificar(token);
    if (!datos) throw this.enlaceInvalido();

    const ahora = new Date();
    // Condición atómica: el estado se revisa en el mismo UPDATE que lo cambia
    const { count } = await this.prisma.lead.updateMany({
      where: {
        email: datos.email,
        activo: false,
        OR: [{ fechaBaja: null }, { fechaBaja: { lte: datos.emitido } }],
      },
      data: { activo: true, fechaBaja: null, fechaSuscripcion: ahora },
    });
    if (count > 0) return { mensaje: MENSAJE_SUSCRIPCION_CONFIRMADA };

    const lead = await this.prisma.lead.findUnique({
      where: { email: datos.email },
      select: { activo: true },
    });
    if (lead?.activo) return { mensaje: MENSAJE_SUSCRIPCION_CONFIRMADA };
    throw this.enlaceInvalido();
  }

  private enlaceInvalido(): BadRequestException {
    return new BadRequestException(
      'El enlace de confirmación no es válido o ya venció.',
    );
  }
}
