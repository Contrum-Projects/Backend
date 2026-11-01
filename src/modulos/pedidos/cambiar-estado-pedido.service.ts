import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoCambioEstadoPedido,
} from '../../colas/colas.js';
import { encolarCorreos } from '../../colas/encolar-correo.js';
import {
  ESTADOS_ENVIO,
  ESTADOS_NOTIFICACION,
  ESTADOS_PEDIDO,
  TIPOS_ENTREGA,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PEDIDO_NO_EXISTE } from './cancelar-pedido.service.js';
import type { CambiarEstadoPedidoDto } from './dto/cambiar-estado-pedido.dto.js';
import {
  ESTADOS_CON_AVISO,
  ETIQUETAS_ESTADO,
  type SentidoCambio,
  sentidoDelCambio,
} from './transiciones-estado-pedido.js';

export const COMENTARIO_AL_RETROCEDER =
  'El comentario es obligatorio al volver a un estado anterior.';
export const CODIGO_AL_DESPACHAR =
  'El código de seguimiento es obligatorio al despachar el pedido.';
export const CODIGO_SOLO_AL_DESPACHAR =
  'El código de seguimiento solo se indica al despachar el pedido.';
export const PEDIDO_SIN_ENVIO = 'El pedido no tiene los datos del envío.';
export const COMENTARIO_ENTREGA_COURIER = 'Chilexpress informó la entrega.';

const LARGO_ASUNTO = 200;

export interface PedidoConNuevoEstado {
  codigoPublico: string;
  estado: string;
}

const etiqueta = (estado: string): string =>
  (ETIQUETAS_ESTADO as Record<string, string | undefined>)[estado] ?? estado;

export const estadoNoPermitido = (actual: string, destino: string): string =>
  `No se puede cambiar un pedido de «${etiqueta(actual)}» a «${etiqueta(destino)}».`;

interface PedidoBloqueado {
  id: number;
  codigoPublico: string;
  estado: string;
  tipoEntrega: string;
  compradorId: number;
}

/**
 * Lo que un cambio del personal le hace al envío (E7-H3); `null` si no lo toca. Volver desde
 * «entregado» deja el envío `con_problema` hasta que el personal lo corrija, y volver a «en
 * preparación» borra el código, que se pide de nuevo al despachar.
 */
const datosDelEnvio = (
  sentido: SentidoCambio,
  actual: string,
  destino: string,
  codigoSeguimiento: string | undefined,
): Prisma.EnvioUpdateManyMutationInput | null => {
  if (sentido === 'avance') {
    if (destino === ESTADOS_PEDIDO.DESPACHADO) {
      return { codigoSeguimiento, estadoEnvio: ESTADOS_ENVIO.EN_TRANSITO };
    }
    return destino === ESTADOS_PEDIDO.ENTREGADO
      ? { estadoEnvio: ESTADOS_ENVIO.ENTREGADO }
      : null;
  }
  if (actual === ESTADOS_PEDIDO.ENTREGADO) {
    return { estadoEnvio: ESTADOS_ENVIO.CON_PROBLEMA };
  }
  return actual === ESTADOS_PEDIDO.DESPACHADO
    ? { codigoSeguimiento: null, estadoEnvio: ESTADOS_ENVIO.PENDIENTE }
    : null;
};

/**
 * Cambio de estado de un pedido por el personal (E8-H2, RF-08.02 a RF-08.04): guarda el cambio en
 * el historial con quién lo hizo y el comentario, actualiza el estado y, si es un cambio clave,
 * deja el aviso al cliente como NOTIFICACION pendiente, todo en una transacción (RNF-12). El
 * correo se encola después del commit; enviarlo es del worker de correos.
 */
@Injectable()
export class CambiarEstadoPedidoService {
  private readonly logger = new Logger(CambiarEstadoPedidoService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(COLAS.CORREOS) private readonly correos: Queue,
  ) {}

  /**
   * E8-H2 · Pasa el pedido `codigoPedido` a `dto.estado` en nombre del integrante del personal
   * `codigoPublicoPersonal`. Bloquea la fila del pedido antes de mirar su estado (igual que la
   * cancelación), así dos cambios o un pago simultáneos se ordenan y el segundo ve el estado ya
   * cambiado. Un cambio que la secuencia no permite responde 409; volver atrás exige comentario.
   */
  async cambiar(
    codigoPublicoPersonal: string,
    codigoPedido: string,
    dto: CambiarEstadoPedidoDto,
  ): Promise<PedidoConNuevoEstado> {
    const { respuesta, aviso } = await this.prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRaw<
        Omit<PedidoBloqueado, 'codigoPublico'>[]
      >`
        SELECT id_pedido AS id,
               estado_actual AS estado,
               tipo_entrega AS "tipoEntrega",
               id_usuario AS "compradorId"
        FROM pedido
        WHERE codigo_publico = ${codigoPedido}
        FOR NO KEY UPDATE`;
      const pedido = filas[0];
      if (!pedido) throw new NotFoundException(PEDIDO_NO_EXISTE);

      const sentido = sentidoDelCambio(
        pedido.estado,
        dto.estado,
        pedido.tipoEntrega,
      );
      if (!sentido) {
        throw new ConflictException(
          estadoNoPermitido(pedido.estado, dto.estado),
        );
      }
      if (sentido === 'retroceso' && !dto.comentario) {
        throw new BadRequestException(COMENTARIO_AL_RETROCEDER);
      }
      const seDespacha =
        sentido === 'avance' && dto.estado === ESTADOS_PEDIDO.DESPACHADO;
      if (seDespacha && !dto.codigoSeguimiento) {
        throw new BadRequestException(CODIGO_AL_DESPACHAR);
      }
      if (!seDespacha && dto.codigoSeguimiento) {
        throw new BadRequestException(CODIGO_SOLO_AL_DESPACHAR);
      }

      const datosEnvio = datosDelEnvio(
        sentido,
        pedido.estado,
        dto.estado,
        dto.codigoSeguimiento,
      );
      if (datosEnvio && pedido.tipoEntrega === TIPOS_ENTREGA.DESPACHO) {
        const { count } = await tx.envio.updateMany({
          where: { pedidoId: pedido.id },
          data: datosEnvio,
        });
        if (seDespacha && count === 0) {
          throw new ConflictException(PEDIDO_SIN_ENVIO);
        }
      }

      const personal = await tx.usuario.findUniqueOrThrow({
        where: { codigoPublico: codigoPublicoPersonal },
        select: { id: true },
      });
      const aviso = await this.guardarCambio(
        tx,
        { ...pedido, codigoPublico: codigoPedido },
        dto.estado,
        personal.id,
        dto.comentario,
        sentido === 'avance',
      );

      return {
        respuesta: { codigoPublico: codigoPedido, estado: dto.estado },
        aviso,
      };
    });

    await this.encolarAviso(aviso);
    return respuesta;
  }

  /**
   * E7-H3 · El courier informó la entrega: el envío y el pedido quedan entregados, sin usuario en el
   * historial, y se avisa al cliente. No hace nada si el personal cambió el pedido o su código
   * mientras se consultaba, o si ya lo había devuelto desde «entregado».
   */
  async registrarEntregaDelCourier(
    pedidoId: number,
    codigoSeguimiento: string,
  ): Promise<void> {
    const aviso = await this.prisma.$transaction(async (tx) => {
      const pedido = await this.bloquearSeguible(tx, pedidoId);
      if (!pedido) return null;

      const { count } = await tx.envio.updateMany({
        where: { pedidoId, codigoSeguimiento },
        data: { estadoEnvio: ESTADOS_ENVIO.ENTREGADO },
      });
      if (count === 0) return null;

      return this.guardarCambio(
        tx,
        pedido,
        ESTADOS_PEDIDO.ENTREGADO,
        null,
        COMENTARIO_ENTREGA_COURIER,
        true,
      );
    });

    await this.encolarAviso(aviso);
  }

  /**
   * E7-H3 · El courier informó otro estado que no es la entrega. Con el pedido bloqueado, para no
   * pisar un cambio del personal hecho mientras se consultaba.
   */
  async actualizarEstadoDelEnvio(
    pedidoId: number,
    codigoSeguimiento: string,
    estadoEnvio: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const pedido = await this.bloquearSeguible(tx, pedidoId);
      if (!pedido) return;

      await tx.envio.updateMany({
        where: { pedidoId, codigoSeguimiento },
        data: { estadoEnvio },
      });
    });
  }

  /** Bloquea el pedido; `null` si ya no corresponde seguirlo: no está despachado o ya se entregó. */
  private async bloquearSeguible(
    tx: Prisma.TransactionClient,
    pedidoId: number,
  ): Promise<PedidoBloqueado | null> {
    const filas = await tx.$queryRaw<PedidoBloqueado[]>`
      SELECT id_pedido AS id,
             codigo_publico AS "codigoPublico",
             estado_actual AS estado,
             tipo_entrega AS "tipoEntrega",
             id_usuario AS "compradorId"
      FROM pedido
      WHERE id_pedido = ${pedidoId}
      FOR NO KEY UPDATE`;
    const pedido = filas[0];
    if (pedido?.estado !== ESTADOS_PEDIDO.DESPACHADO) return null;

    const entregasPrevias = await tx.historialEstadoPedido.count({
      where: { pedidoId, estado: ESTADOS_PEDIDO.ENTREGADO },
    });
    return entregasPrevias > 0 ? null : pedido;
  }

  /** Historial, estado del pedido y, si es un avance clave, la NOTIFICACION (RNF-12). */
  private async guardarCambio(
    tx: Prisma.TransactionClient,
    pedido: PedidoBloqueado,
    estado: string,
    usuarioId: number | null,
    comentario: string | undefined,
    esAvance: boolean,
  ): Promise<TrabajoCambioEstadoPedido | null> {
    const ultimo = await tx.historialEstadoPedido.aggregate({
      where: { pedidoId: pedido.id },
      _max: { correlativo: true },
    });
    await tx.historialEstadoPedido.create({
      data: {
        pedidoId: pedido.id,
        correlativo: (ultimo._max.correlativo ?? 0) + 1,
        usuarioId,
        estado,
        comentario,
      },
    });
    await tx.pedido.update({
      where: { id: pedido.id },
      data: { estadoActual: estado },
    });

    if (!esAvance || !ESTADOS_CON_AVISO.includes(estado)) return null;

    const comprador = await tx.usuario.findUniqueOrThrow({
      where: { id: pedido.compradorId },
      select: { email: true, nombre: true },
    });
    const notificacion = await tx.notificacion.create({
      data: {
        usuarioId: pedido.compradorId,
        pedidoId: pedido.id,
        tipo: TIPOS_NOTIFICACION.CAMBIO_ESTADO_PEDIDO,
        asunto:
          `Tu pedido ${pedido.codigoPublico} está ${etiqueta(estado)}`.slice(
            0,
            LARGO_ASUNTO,
          ),
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
      },
      select: { id: true },
    });
    return {
      notificacionId: notificacion.id,
      destinatario: comprador.email,
      nombre: comprador.nombre,
      codigoPedido: pedido.codigoPublico,
      estado,
      tipoEntrega: pedido.tipoEntrega,
    };
  }

  /** Después del commit; con Redis caído la NOTIFICACION queda pendiente y no falla (RNF-32). */
  private async encolarAviso(
    aviso: TrabajoCambioEstadoPedido | null,
  ): Promise<void> {
    if (!aviso) return;
    await encolarCorreos(
      this.correos,
      TRABAJOS_CORREO.CAMBIO_ESTADO_PEDIDO,
      [aviso],
      this.logger,
    );
  }
}
