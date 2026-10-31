import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ESTADOS_PAGO, ESTADOS_PEDIDO } from '../../common/dominio/valores.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CancelarPedidoService } from '../pedidos/cancelar-pedido.service.js';
import { AplicarPagoService } from './aplicar-pago.service.js';
import { PasarelaPago } from './pasarela-pago.js';

const LOTE_VENCIDOS = 100;

/**
 * Cancelación automática de los pedidos impagos (E6-H3, RF-06.04). El plazo se toma de
 * `fechaExpiracionPago`, que vive en la base: si Redis se cae, la pasada siguiente los alcanza
 * (RNF-29). Antes de cancelar se le pregunta a Mercado Pago, porque no hay reembolsos y una
 * notificación atrasada no debe dejar cobrado un pedido cancelado.
 */
@Injectable()
export class VencimientoPagoService {
  private readonly logger = new Logger(VencimientoPagoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pasarela: PasarelaPago,
    private readonly aplicarPago: AplicarPagoService,
    private readonly cancelarPedido: CancelarPedidoService,
  ) {}

  /**
   * E6-H3 · Lo hace la tarea periódica. Si Mercado Pago no responde corta la pasada, porque los
   * demás pedidos fallarían igual, y nada se cancela hasta que responda. Otra falla solo afecta a
   * su pedido, que se reintenta en la pasada siguiente.
   */
  async cancelarVencidos(): Promise<void> {
    const vencidos = await this.prisma.pedido.findMany({
      where: {
        estadoActual: ESTADOS_PEDIDO.PENDIENTE_PAGO,
        fechaExpiracionPago: { lte: new Date() },
      },
      orderBy: { fechaExpiracionPago: 'asc' },
      take: LOTE_VENCIDOS,
      select: { id: true, codigoPublico: true },
    });

    for (const { id, codigoPublico } of vencidos) {
      try {
        await this.aplicarPagosRecibidos(codigoPublico);
        await this.cancelarPedido.cancelarPorImpago(id);
      } catch (error) {
        if (error instanceof ServiceUnavailableException) {
          this.logger.warn(
            `Cancelación por impago en espera: ${error.message}`,
          );
          return;
        }
        this.logger.error(
          `No se pudo cancelar por impago el pedido ${codigoPublico}: ${(error as Error).message}`,
        );
      }
    }
  }

  /** RNF-29: un pago aprobado deja el pedido pagado y `cancelarPorImpago` ya no lo toca. */
  private async aplicarPagosRecibidos(codigoPedido: string): Promise<void> {
    const pagos = await this.pasarela.buscarPagosDePedido(codigoPedido);
    for (const pago of pagos) {
      if (
        pago.estado !== ESTADOS_PAGO.APROBADO ||
        pago.codigoPedido !== codigoPedido
      ) {
        continue;
      }
      try {
        await this.aplicarPago.aplicar(pago);
      } catch (error) {
        // Otro monto o segundo pago: ya quedó la advertencia y no cuenta como pago del pedido
        if (
          !(error instanceof BadRequestException) &&
          !(error instanceof ConflictException)
        ) {
          throw error;
        }
      }
    }
  }
}
