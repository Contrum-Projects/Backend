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
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PEDIDO_NO_EXISTE } from './cancelar-pedido.service.js';
import type { CambiarEstadoPedidoDto } from './dto/cambiar-estado-pedido.dto.js';
import {
  ESTADOS_CON_AVISO,
  ETIQUETAS_ESTADO,
  sentidoDelCambio,
} from './transiciones-estado-pedido.js';

export const COMENTARIO_AL_RETROCEDER =
  'El comentario es obligatorio al volver a un estado anterior.';

const LARGO_ASUNTO = 200;

export interface PedidoConNuevoEstado {
  codigoPublico: string;
  estado: string;
}

const etiqueta = (estado: string): string =>
  (ETIQUETAS_ESTADO as Record<string, string | undefined>)[estado] ?? estado;

export const estadoNoPermitido = (actual: string, destino: string): string =>
  `No se puede cambiar un pedido de «${etiqueta(actual)}» a «${etiqueta(destino)}».`;

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
        {
          id: number;
          estado: string;
          tipoEntrega: string;
          compradorId: number;
        }[]
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

      const personal = await tx.usuario.findUniqueOrThrow({
        where: { codigoPublico: codigoPublicoPersonal },
        select: { id: true },
      });
      const ultimo = await tx.historialEstadoPedido.aggregate({
        where: { pedidoId: pedido.id },
        _max: { correlativo: true },
      });
      await tx.historialEstadoPedido.create({
        data: {
          pedidoId: pedido.id,
          correlativo: (ultimo._max.correlativo ?? 0) + 1,
          usuarioId: personal.id,
          estado: dto.estado,
          comentario: dto.comentario,
        },
      });
      await tx.pedido.update({
        where: { id: pedido.id },
        data: { estadoActual: dto.estado },
      });

      let aviso: TrabajoCambioEstadoPedido | null = null;
      if (sentido === 'avance' && ESTADOS_CON_AVISO.includes(dto.estado)) {
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
              `Tu pedido ${codigoPedido} está ${etiqueta(dto.estado)}`.slice(
                0,
                LARGO_ASUNTO,
              ),
            estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
          },
          select: { id: true },
        });
        aviso = {
          notificacionId: notificacion.id,
          destinatario: comprador.email,
          nombre: comprador.nombre,
          codigoPedido,
          estado: dto.estado,
          tipoEntrega: pedido.tipoEntrega,
        };
      }

      return {
        respuesta: { codigoPublico: codigoPedido, estado: dto.estado },
        aviso,
      };
    });

    // Después del commit; con Redis caído la NOTIFICACION queda pendiente y la petición no falla
    if (aviso) {
      await encolarCorreos(
        this.correos,
        TRABAJOS_CORREO.CAMBIO_ESTADO_PEDIDO,
        [aviso],
        this.logger,
      );
    }
    return respuesta;
  }
}
