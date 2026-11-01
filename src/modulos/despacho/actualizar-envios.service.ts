import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ESTADOS_ENVIO, ESTADOS_PEDIDO } from '../../common/dominio/valores.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CambiarEstadoPedidoService } from '../pedidos/cambiar-estado-pedido.service.js';
import { SeguimientoEnvio } from './seguimiento-envio.js';

const LOTE_ENVIOS = 100;

interface EnvioEnCamino {
  id: number;
  pedidoId: number;
  codigoSeguimiento: string | null;
  estadoEnvio: string;
  pedido: { codigoPublico: string };
}

/**
 * Actualiza el estado de los envíos con lo que informa el courier (E7-H3, RF-07.05). Lo hace una
 * tarea periódica, así que ver un pedido no depende del courier ni de Redis (RNF-32).
 */
@Injectable()
export class ActualizarEnviosService {
  private readonly logger = new Logger(ActualizarEnviosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly seguimiento: SeguimientoEnvio,
    private readonly cambioEstado: CambiarEstadoPedidoService,
  ) {}

  /**
   * Revisa los pedidos despachados con código. Un pedido que ya estuvo entregado y que el personal
   * devolvió a despachado no se consulta: Chilexpress seguiría informando la entrega y desharía la
   * corrección. Si el courier no responde corta la pasada, porque los demás fallarían igual.
   */
  async actualizar(): Promise<void> {
    let ultimoId = 0;
    for (;;) {
      const envios = await this.prisma.envio.findMany({
        where: {
          id: { gt: ultimoId },
          codigoSeguimiento: { not: null },
          pedido: {
            estadoActual: ESTADOS_PEDIDO.DESPACHADO,
            historial: { none: { estado: ESTADOS_PEDIDO.ENTREGADO } },
          },
        },
        orderBy: { id: 'asc' },
        take: LOTE_ENVIOS,
        select: {
          id: true,
          pedidoId: true,
          codigoSeguimiento: true,
          estadoEnvio: true,
          pedido: { select: { codigoPublico: true } },
        },
      });

      for (const envio of envios) {
        try {
          await this.actualizarEnvio(envio);
        } catch (error) {
          if (error instanceof ServiceUnavailableException) {
            this.logger.warn(`Seguimiento en espera: ${error.message}`);
            return;
          }
          this.logger.error(
            `No se pudo actualizar el envío ${envio.id}: ${(error as Error).message}`,
          );
        }
      }

      if (envios.length < LOTE_ENVIOS) return;
      ultimoId = envios[envios.length - 1].id;
    }
  }

  private async actualizarEnvio(envio: EnvioEnCamino): Promise<void> {
    const codigo = envio.codigoSeguimiento;
    if (!codigo) return;

    const estado = await this.seguimiento.consultar({
      codigoSeguimiento: codigo,
      referencia: envio.pedido.codigoPublico,
    });
    if (!estado) {
      this.logger.warn(
        `El courier no informó un estado reconocido para el envío ${envio.id}.`,
      );
      return;
    }
    if (estado === envio.estadoEnvio) return;

    if (estado === ESTADOS_ENVIO.ENTREGADO) {
      await this.cambioEstado.registrarEntregaDelCourier(
        envio.pedidoId,
        codigo,
      );
      return;
    }
    // Con la condición en la misma escritura: el personal pudo devolver el pedido durante la consulta
    await this.prisma.envio.updateMany({
      where: {
        id: envio.id,
        codigoSeguimiento: codigo,
        pedido: { estadoActual: ESTADOS_PEDIDO.DESPACHADO },
      },
      data: { estadoEnvio: estado },
    });
  }
}
