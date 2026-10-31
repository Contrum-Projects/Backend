import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { pagarHastaDe } from '../../common/dominio/plazo-pago.js';
import {
  ESTADOS_PAGO,
  ESTADOS_PEDIDO,
  type Valor,
} from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PEDIDO_NO_EXISTE } from '../pedidos/codigo-pedido.pipe.js';
import {
  type DetallePedidoCuenta,
  MisPedidosService,
} from '../pedidos/mis-pedidos.service.js';
import {
  AplicarPagoService,
  PAGO_NO_CORRESPONDE,
  PEDIDO_CANCELADO,
  PEDIDO_YA_PAGADO,
} from './aplicar-pago.service.js';
import { PasarelaPago } from './pasarela-pago.js';

export const PLAZO_VENCIDO =
  'Se acabó el plazo para pagar este pedido y su reserva se liberará.';

export interface CobroIniciado {
  /** Adonde se lleva al comprador para pagar en Mercado Pago. */
  urlPago: string;
  pagarHasta: Date;
}

export interface PagoConfirmado {
  estadoPago: Valor<typeof ESTADOS_PAGO>;
  pedido: DetallePedidoCuenta;
}

/**
 * Pago del pedido en Mercado Pago por su dueño (E6-H1, RF-06.01, RF-06.05). El cobro es siempre
 * por el total guardado en el pedido; el resultado se consulta a Mercado Pago, nunca se toma del
 * navegador.
 */
@Injectable()
export class PagarPedidoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
    private readonly pasarela: PasarelaPago,
    private readonly aplicarPago: AplicarPagoService,
    private readonly misPedidos: MisPedidosService,
  ) {}

  /**
   * E6-H1 · Prepara el cobro del pedido y devuelve la URL de pago. Se puede pedir otra vez tras
   * un rechazo, mientras el pedido siga pendiente y dentro del plazo.
   */
  async iniciar(
    codigoUsuario: string,
    codigoPedido: string,
  ): Promise<CobroIniciado> {
    const pedido = await this.prisma.pedido.findFirst({
      where: {
        codigoPublico: codigoPedido,
        usuario: { codigoPublico: codigoUsuario },
      },
      select: {
        estadoActual: true,
        montoTotal: true,
        fechaExpiracionPago: true,
      },
    });
    if (!pedido) throw new NotFoundException(PEDIDO_NO_EXISTE);
    if (pedido.estadoActual === ESTADOS_PEDIDO.CANCELADO) {
      throw new ConflictException(PEDIDO_CANCELADO);
    }
    if (pedido.estadoActual !== ESTADOS_PEDIDO.PENDIENTE_PAGO) {
      throw new ConflictException(PEDIDO_YA_PAGADO);
    }
    const pagarHasta = pagarHastaDe(pedido.fechaExpiracionPago);
    if (pagarHasta.getTime() <= Date.now()) {
      throw new ConflictException(PLAZO_VENCIDO);
    }

    const tienda = this.config.get('URL_TIENDA', { infer: true });
    const urlPago = await this.pasarela.crearCobro({
      codigoPedido,
      montoTotal: pedido.montoTotal,
      pagarHasta,
      urlRegreso: `${tienda.replace(/\/+$/, '')}/pedidos/${codigoPedido}/pago`,
    });
    return { urlPago, pagarHasta };
  }

  /**
   * E6-H1 · El comprador volvió de Mercado Pago con el id del pago: se consulta a Mercado Pago y
   * se aplica al pedido. Rechazado, el pedido sigue pendiente de pago.
   */
  async confirmar(
    codigoUsuario: string,
    codigoPedido: string,
    idPago: string,
  ): Promise<PagoConfirmado> {
    const pedido = await this.prisma.pedido.findFirst({
      where: {
        codigoPublico: codigoPedido,
        usuario: { codigoPublico: codigoUsuario },
      },
      select: { id: true },
    });
    if (!pedido) throw new NotFoundException(PEDIDO_NO_EXISTE);

    const pago = await this.pasarela.consultarPago(idPago);
    if (!pago || pago.codigoPedido !== codigoPedido) {
      throw new BadRequestException(PAGO_NO_CORRESPONDE);
    }
    const estadoPago = await this.aplicarPago.aplicar(pago);
    return {
      estadoPago,
      pedido: await this.misPedidos.obtener(codigoUsuario, codigoPedido),
    };
  }
}
