import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TIPOS_SALIDA } from '../../common/dominio/valores.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CrearSalidaDto } from './dto/crear-salida.dto.js';

type Tx = Prisma.TransactionClient;
type TipoSalida = (typeof TIPOS_SALIDA)[number];

/** La salida tal como la ve el panel después de registrarla. */
export interface SalidaRegistrada {
  movimientoId: number;
  tipo: TipoSalida;
  formatoId: number;
  ubicacion: { id: number; codigo: string; bodega: string };
  cantidad: number;
  stockRestante: number;
  observacion: string | null;
  fechaHora: Date;
}

/**
 * Salidas de inventario que no son venta (E11-H3, RF-11.06 y RF-11.11): merma por vencimiento,
 * merma por daño y consumo en la peluquería. El stock se descuenta y el movimiento que lo explica
 * se crea en una misma transacción (RNF-12); el stock nunca queda bajo cero (RNF-13).
 */
@Injectable()
export class SalidasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Descuenta la cantidad del stock del formato en la ubicación y deja un movimiento con el tipo
   * de salida. Si la ubicación no tiene stock suficiente, responde 400 sin cambiar nada. Se admiten
   * formatos y ubicaciones desactivados: su stock físico también puede vencer o dañarse.
   */
  async registrar(
    dto: CrearSalidaDto,
    codigoPublicoUsuario: string,
  ): Promise<SalidaRegistrada> {
    return this.prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.findUnique({
        where: { codigoPublico: codigoPublicoUsuario },
        select: { id: true },
      });
      if (!usuario) {
        throw new UnauthorizedException('Debes iniciar sesión.');
      }
      await this.comprobarFormato(tx, dto.formatoId);
      const ubicacion = await this.ubicacionDe(tx, dto.ubicacionId);

      const stockRestante = await this.descontar(tx, dto);
      const movimiento = await tx.movimientoInventario.create({
        data: {
          formatoId: dto.formatoId,
          ubicacionOrigenId: dto.ubicacionId,
          usuarioId: usuario.id,
          tipo: dto.tipo,
          cantidad: dto.cantidad,
          observacion: dto.observacion ?? null,
        },
        select: { id: true, fechaHora: true },
      });

      return {
        movimientoId: movimiento.id,
        tipo: dto.tipo as TipoSalida,
        formatoId: dto.formatoId,
        ubicacion,
        cantidad: dto.cantidad,
        stockRestante,
        observacion: dto.observacion ?? null,
        fechaHora: movimiento.fechaHora,
      };
    });
  }

  private async comprobarFormato(tx: Tx, id: number) {
    const formato = await tx.formatoProducto.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!formato) {
      throw new BadRequestException('El formato no existe.');
    }
  }

  private async ubicacionDe(tx: Tx, id: number) {
    const ubicacion = await tx.ubicacion.findUnique({
      where: { id },
      select: { id: true, codigo: true, bodega: { select: { nombre: true } } },
    });
    if (!ubicacion) {
      throw new BadRequestException('La ubicación no existe.');
    }
    return {
      id: ubicacion.id,
      codigo: ubicacion.codigo,
      bodega: ubicacion.bodega.nombre,
    };
  }

  /**
   * Descuenta con una condición atómica (`cantidad >= n`), sin leer antes: dos salidas
   * simultáneas no pueden dejar el stock bajo cero (RNF-13). Devuelve el stock que queda.
   */
  private async descontar(tx: Tx, dto: CrearSalidaDto): Promise<number> {
    const clave = {
      formatoId: dto.formatoId,
      ubicacionId: dto.ubicacionId,
    };
    const { count } = await tx.existencia.updateMany({
      where: { ...clave, cantidad: { gte: dto.cantidad } },
      data: { cantidad: { decrement: dto.cantidad } },
    });
    const existencia = await tx.existencia.findUnique({
      where: { formatoId_ubicacionId: clave },
      select: { cantidad: true },
    });
    const disponible = existencia?.cantidad ?? 0;
    if (count === 0) {
      throw new BadRequestException(
        `No hay stock suficiente en esa ubicación: hay ${disponible} y la salida es de ${dto.cantidad}.`,
      );
    }
    return disponible;
  }
}
