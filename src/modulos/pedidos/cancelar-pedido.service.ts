import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ESTADOS_PEDIDO } from '../../common/dominio/valores.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { VentaStockService } from '../inventario/venta-stock.service.js';
import type { CancelarPedidoDto } from './dto/cancelar-pedido.dto.js';

export const PEDIDO_NO_EXISTE = 'El pedido no existe.';
export const SOLO_PENDIENTE_DE_PAGO =
  'Solo se puede cancelar un pedido pendiente de pago.';
export const COMENTARIO_IMPAGO = 'Plazo de pago vencido.';

export interface PedidoCancelado {
  codigoPublico: string;
  estado: string;
}

/**
 * Cancelación de un pedido que aún no se paga, por el personal (E8-H3, RF-08.05): lo deja
 * cancelado, devuelve su stock y registra el cambio en el historial, todo en una transacción
 * (RNF-12).
 */
@Injectable()
export class CancelarPedidoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ventaStock: VentaStockService,
  ) {}

  /**
   * E8-H3 · Cancela el pedido `codigoPedido` en nombre del integrante del personal
   * `codigoPublicoPersonal`. Bloquea la fila del pedido antes de mirar su estado: si el pago
   * (E6) o otra cancelación llegan a la vez, una espera a la otra y la segunda ve el estado ya
   * cambiado. Solo se cancela un pedido pendiente de pago; cualquier otro estado responde 409.
   */
  cancelar(
    codigoPublicoPersonal: string,
    codigoPedido: string,
    dto: CancelarPedidoDto,
  ): Promise<PedidoCancelado> {
    return this.prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRaw<{ id: number; estado: string }[]>`
        SELECT id_pedido AS id, estado_actual AS estado
        FROM pedido
        WHERE codigo_publico = ${codigoPedido}
        FOR NO KEY UPDATE`;
      const pedido = filas[0];
      if (!pedido) throw new NotFoundException(PEDIDO_NO_EXISTE);
      if (pedido.estado !== ESTADOS_PEDIDO.PENDIENTE_PAGO) {
        throw new ConflictException(SOLO_PENDIENTE_DE_PAGO);
      }

      const personal = await tx.usuario.findUniqueOrThrow({
        where: { codigoPublico: codigoPublicoPersonal },
        select: { id: true },
      });
      await this.registrarCancelacion(
        tx,
        pedido.id,
        personal.id,
        dto.comentario,
      );

      return {
        codigoPublico: codigoPedido,
        estado: ESTADOS_PEDIDO.CANCELADO,
      };
    });
  }

  /**
   * E6-H3 · Cancela un pedido cuyo plazo de pago venció, sin usuario. Bloquea la fila antes de
   * mirar su estado: un pedido que ya se pagó o se canceló no cambia y devuelve `false`.
   */
  cancelarPorImpago(pedidoId: number): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRaw<{ estado: string }[]>`
        SELECT estado_actual AS estado
        FROM pedido
        WHERE id_pedido = ${pedidoId}
        FOR NO KEY UPDATE`;
      if (filas[0]?.estado !== ESTADOS_PEDIDO.PENDIENTE_PAGO) return false;

      await this.registrarCancelacion(tx, pedidoId, null, COMENTARIO_IMPAGO);
      return true;
    });
  }

  /** Devuelve el stock, agrega el cambio al historial y deja el pedido cancelado (RNF-12). */
  private async registrarCancelacion(
    tx: Prisma.TransactionClient,
    pedidoId: number,
    usuarioId: number | null,
    comentario: string | undefined,
  ): Promise<void> {
    await this.ventaStock.reingresarPorPedido(tx, pedidoId, usuarioId);

    const ultimo = await tx.historialEstadoPedido.aggregate({
      where: { pedidoId },
      _max: { correlativo: true },
    });
    await tx.historialEstadoPedido.create({
      data: {
        pedidoId,
        correlativo: (ultimo._max.correlativo ?? 0) + 1,
        usuarioId,
        estado: ESTADOS_PEDIDO.CANCELADO,
        comentario,
      },
    });
    await tx.pedido.update({
      where: { id: pedidoId },
      data: { estadoActual: ESTADOS_PEDIDO.CANCELADO },
    });
  }
}
