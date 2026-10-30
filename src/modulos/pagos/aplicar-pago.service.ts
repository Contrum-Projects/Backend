import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  ESTADOS_PAGO,
  ESTADOS_PEDIDO,
  type Valor,
} from '../../common/dominio/valores.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { PagoPasarela } from './pasarela-pago.js';

type Tx = Prisma.TransactionClient;

export const PAGO_NO_CORRESPONDE = 'El pago no corresponde a este pedido.';
export const MONTO_NO_CORRESPONDE =
  'El monto pagado no corresponde al total del pedido.';
export const PEDIDO_YA_PAGADO = 'El pedido ya está pagado.';
export const PEDIDO_CANCELADO = 'El pedido fue cancelado.';

const MONEDA = 'CLP';

/**
 * Aplica al pedido un pago informado por Mercado Pago (E6-H1). Lo usa el regreso del comprador
 * y lo usará la notificación de E6-H2. Todo en una transacción con la fila del pedido bloqueada
 * (RNF-12): dos avisos del mismo pago, o un pago y la cancelación (E8-H3), se ordenan y el
 * segundo ve lo que dejó el primero.
 */
@Injectable()
export class AplicarPagoService {
  private readonly logger = new Logger(AplicarPagoService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra el pago y devuelve su estado. Aprobado y por el total: el pedido queda pagado. El
   * mismo pago dos veces no cambia nada. Un segundo pago aprobado, o uno que llega con el pedido
   * cancelado, no se registra (409): el pedido tiene a lo más un pago aprobado.
   */
  async aplicar(pago: PagoPasarela): Promise<Valor<typeof ESTADOS_PAGO>> {
    const codigoPedido = pago.codigoPedido;
    if (!codigoPedido) throw new BadRequestException(PAGO_NO_CORRESPONDE);

    return this.prisma.$transaction(async (tx) => {
      const [pedido] = await tx.$queryRaw<
        { id: number; estado: string; montoTotal: number }[]
      >`
        SELECT id_pedido AS id, estado_actual AS estado, monto_total AS "montoTotal"
        FROM pedido
        WHERE codigo_publico = ${codigoPedido}
        FOR NO KEY UPDATE`;
      if (!pedido) throw new BadRequestException(PAGO_NO_CORRESPONDE);

      const registrado = await tx.pago.findUnique({
        where: { idTransaccionExterna: pago.idExterno },
        select: { id: true, pedidoId: true, estado: true },
      });
      if (registrado && registrado.pedidoId !== pedido.id) {
        throw new BadRequestException(PAGO_NO_CORRESPONDE);
      }
      // Ya aplicado: repetir el aviso no cambia nada
      if (registrado?.estado === ESTADOS_PAGO.APROBADO) {
        return ESTADOS_PAGO.APROBADO;
      }

      if (pago.estado !== ESTADOS_PAGO.APROBADO) {
        // Rechazado o pendiente: queda el intento y el pedido sigue esperando el pago
        await this.guardar(tx, pedido.id, registrado?.id, pago);
        return pago.estado;
      }

      if (pago.monto !== pedido.montoTotal || pago.moneda !== MONEDA) {
        this.advertir('con un monto distinto del total', codigoPedido, pago);
        throw new BadRequestException(MONTO_NO_CORRESPONDE);
      }
      if (pedido.estado === ESTADOS_PEDIDO.CANCELADO) {
        this.advertir('para un pedido cancelado', codigoPedido, pago);
        throw new ConflictException(PEDIDO_CANCELADO);
      }
      if (pedido.estado !== ESTADOS_PEDIDO.PENDIENTE_PAGO) {
        this.advertir('para un pedido ya pagado', codigoPedido, pago);
        throw new ConflictException(PEDIDO_YA_PAGADO);
      }

      // Se aplica aunque el plazo haya vencido, si el pedido aún no se cancela (RNF-29)
      await this.guardar(tx, pedido.id, registrado?.id, pago);
      const ultimo = await tx.historialEstadoPedido.aggregate({
        where: { pedidoId: pedido.id },
        _max: { correlativo: true },
      });
      await tx.historialEstadoPedido.create({
        data: {
          pedidoId: pedido.id,
          correlativo: (ultimo._max.correlativo ?? 0) + 1,
          usuarioId: null,
          estado: ESTADOS_PEDIDO.PAGADO,
        },
      });
      await tx.pedido.update({
        where: { id: pedido.id },
        data: { estadoActual: ESTADOS_PEDIDO.PAGADO },
      });
      return ESTADOS_PAGO.APROBADO;
    });
  }

  /** Crea el pago o actualiza el mismo intento (pasa de pendiente a rechazado o aprobado). */
  private async guardar(
    tx: Tx,
    pedidoId: number,
    pagoId: number | undefined,
    pago: PagoPasarela,
  ): Promise<void> {
    // Sin datos de la tarjeta (RNF-05): solo el medio con que se pagó
    const datos = {
      // Pesos enteros: uno aprobado ya se comparó con el total; otro no debe romper el registro
      monto: Math.round(pago.monto),
      estado: pago.estado,
      fechaPago: pago.fechaAprobacion,
      medioPago: pago.medioPago,
    };
    if (pagoId) {
      await tx.pago.update({ where: { id: pagoId }, data: datos });
      return;
    }
    await tx.pago.create({
      data: { ...datos, pedidoId, idTransaccionExterna: pago.idExterno },
    });
  }

  // Queda en el log para que el personal lo revise (Mercado Pago cobró y el pedido no cambia)
  private advertir(motivo: string, codigoPedido: string, pago: PagoPasarela) {
    this.logger.warn(
      `Pago aprobado ${pago.idExterno} ${motivo}: pedido ${codigoPedido}. No se aplicó.`,
    );
  }
}
