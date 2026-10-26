import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TIPOS_MOVIMIENTO } from '../../common/dominio/valores.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  comprobarFormato,
  type UbicacionResumen,
  ubicacionDe,
} from './comprobaciones.js';
import type { CrearTransferenciaDto } from './dto/crear-transferencia.dto.js';
import {
  descontarExistencia,
  stockDe,
  sumarExistencia,
} from './existencias.js';

/** Una ubicación de la transferencia con el stock que le quedó. */
export interface UbicacionTransferencia extends UbicacionResumen {
  stock: number;
}

/** La transferencia tal como la ve el panel después de registrarla. */
export interface TransferenciaRegistrada {
  movimientoId: number;
  formatoId: number;
  origen: UbicacionTransferencia;
  destino: UbicacionTransferencia;
  cantidad: number;
  observacion: string | null;
  fechaHora: Date;
}

/**
 * Transferencias de stock entre ubicaciones (E11-H4, RF-11.08). El descuento en el origen, la
 * suma en el destino y el movimiento con ambas ubicaciones se escriben en una misma transacción
 * (RNF-12); el origen nunca queda bajo cero (RNF-13).
 */
@Injectable()
export class TransferenciasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mueve la cantidad del formato del origen al destino y deja un movimiento `transferencia`. El
   * destino debe estar activo y ser de una bodega activa; el origen puede estar desactivado (para
   * vaciarlo). Si el origen no tiene stock suficiente, 400 sin cambiar nada.
   */
  async registrar(
    dto: CrearTransferenciaDto,
    codigoPublicoUsuario: string,
  ): Promise<TransferenciaRegistrada> {
    if (dto.ubicacionOrigenId === dto.ubicacionDestinoId) {
      throw new BadRequestException(
        'La ubicación de destino debe ser distinta de la de origen.',
      );
    }
    const claveOrigen = {
      formatoId: dto.formatoId,
      ubicacionId: dto.ubicacionOrigenId,
    };
    const claveDestino = {
      formatoId: dto.formatoId,
      ubicacionId: dto.ubicacionDestinoId,
    };

    return this.prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.findUnique({
        where: { codigoPublico: codigoPublicoUsuario },
        select: { id: true },
      });
      if (!usuario) {
        throw new UnauthorizedException('Debes iniciar sesión.');
      }
      await comprobarFormato(tx, dto.formatoId);
      const origen = await ubicacionDe(tx, dto.ubicacionOrigenId);
      const destino = await ubicacionDe(tx, dto.ubicacionDestinoId, {
        activa: true,
      });

      const descontar = () =>
        descontarExistencia(tx, claveOrigen, dto.cantidad, 'la transferencia');
      const sumar = async () => {
        if (!(await sumarExistencia(tx, claveDestino, dto.cantidad))) {
          throw new BadRequestException(
            'El stock de ese formato en la ubicación de destino superaría el máximo permitido.',
          );
        }
      };
      // Las existencias se tocan en orden de ubicación: dos transferencias cruzadas simultáneas
      // (A→B y B→A) no se bloquean entre sí. Si el descuento falla después de sumar, la
      // transacción deshace la suma
      if (dto.ubicacionOrigenId < dto.ubicacionDestinoId) {
        await descontar();
        await sumar();
      } else {
        await sumar();
        await descontar();
      }

      const movimiento = await tx.movimientoInventario.create({
        data: {
          formatoId: dto.formatoId,
          ubicacionOrigenId: dto.ubicacionOrigenId,
          ubicacionDestinoId: dto.ubicacionDestinoId,
          usuarioId: usuario.id,
          tipo: TIPOS_MOVIMIENTO.TRANSFERENCIA,
          cantidad: dto.cantidad,
          observacion: dto.observacion ?? null,
        },
        select: { id: true, fechaHora: true },
      });

      return {
        movimientoId: movimiento.id,
        formatoId: dto.formatoId,
        origen: { ...origen, stock: await stockDe(tx, claveOrigen) },
        destino: { ...destino, stock: await stockDe(tx, claveDestino) },
        cantidad: dto.cantidad,
        observacion: dto.observacion ?? null,
        fechaHora: movimiento.fechaHora,
      };
    });
  }
}
