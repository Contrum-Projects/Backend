import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoPagoConfirmado,
} from '../../colas/colas.js';
import { encolarCorreos } from '../../colas/encolar-correo.js';
import {
  ESTADOS_NOTIFICACION,
  ESTADOS_PAGO,
  ESTADOS_PEDIDO,
  TIPOS_NOTIFICACION,
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
 * Aplica al pedido un pago informado por Mercado Pago (E6-H1). Lo usan el regreso del comprador
 * y la notificación de E6-H2: el primero que llega deja el pedido pagado y el correo de
 * confirmación, por eso el correo nace aquí y sale una sola vez. Todo en una transacción con la
 * fila del pedido bloqueada (RNF-12): dos avisos del mismo pago, o un pago y la cancelación
 * (E8-H3), se ordenan y el segundo ve lo que dejó el primero.
 */
@Injectable()
export class AplicarPagoService {
  private readonly logger = new Logger(AplicarPagoService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(COLAS.CORREOS) private readonly correos: Queue,
  ) {}

  /**
   * Registra el pago y devuelve su estado. Aprobado y por el total: el pedido queda pagado. El
   * mismo pago dos veces no cambia nada. Un segundo pago aprobado, o uno que llega con el pedido
   * cancelado, no se registra (409): el pedido tiene a lo más un pago aprobado.
   */
  async aplicar(pago: PagoPasarela): Promise<Valor<typeof ESTADOS_PAGO>> {
    const codigoPedido = pago.codigoPedido;
    if (!codigoPedido) throw new BadRequestException(PAGO_NO_CORRESPONDE);

    const { estado, aviso } = await this.prisma.$transaction<{
      estado: Valor<typeof ESTADOS_PAGO>;
      aviso?: TrabajoPagoConfirmado;
    }>(async (tx) => {
      const [pedido] = await tx.$queryRaw<
        {
          id: number;
          estado: string;
          montoTotal: number;
          compradorId: number;
        }[]
      >`
        SELECT id_pedido AS id,
               estado_actual AS estado,
               monto_total AS "montoTotal",
               id_usuario AS "compradorId"
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
        return { estado: ESTADOS_PAGO.APROBADO };
      }

      if (pago.estado !== ESTADOS_PAGO.APROBADO) {
        // Rechazado o pendiente: queda el intento y el pedido sigue esperando el pago
        await this.guardar(tx, pedido.id, registrado?.id, pago);
        return { estado: pago.estado };
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
      const aviso = await this.registrarAviso(tx, codigoPedido, pedido);
      return { estado: ESTADOS_PAGO.APROBADO, aviso };
    });

    // Después del commit; con Redis caído la NOTIFICACION queda pendiente y el pago no falla
    if (aviso) {
      await encolarCorreos(
        this.correos,
        TRABAJOS_CORREO.PAGO_CONFIRMADO,
        [aviso],
        this.logger,
      );
    }
    return estado;
  }

  /** Deja el correo de confirmación como NOTIFICACION pendiente, junto con el pago (RNF-12). */
  private async registrarAviso(
    tx: Tx,
    codigoPedido: string,
    pedido: { id: number; montoTotal: number; compradorId: number },
  ): Promise<TrabajoPagoConfirmado> {
    const comprador = await tx.usuario.findUniqueOrThrow({
      where: { id: pedido.compradorId },
      select: { email: true, nombre: true },
    });
    const notificacion = await tx.notificacion.create({
      data: {
        usuarioId: pedido.compradorId,
        pedidoId: pedido.id,
        tipo: TIPOS_NOTIFICACION.PAGO_CONFIRMADO,
        asunto: `Recibimos tu pago · Pedido ${codigoPedido}`,
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
      },
      select: { id: true },
    });
    return {
      notificacionId: notificacion.id,
      destinatario: comprador.email,
      nombre: comprador.nombre,
      codigoPedido,
      montoTotal: pedido.montoTotal,
    };
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
