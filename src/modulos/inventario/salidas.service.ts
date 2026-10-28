import { Injectable, UnauthorizedException } from '@nestjs/common';
import { TIPOS_SALIDA } from '../../common/dominio/valores.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  comprobarFormato,
  type UbicacionResumen,
  ubicacionDe,
} from './comprobaciones.js';
import type { CrearSalidaDto } from './dto/crear-salida.dto.js';
import { descontarExistencia } from './existencias.js';
import { StockBajoService } from './stock-bajo.service.js';

type TipoSalida = (typeof TIPOS_SALIDA)[number];

/** La salida tal como la ve el panel después de registrarla. */
export interface SalidaRegistrada {
  movimientoId: number;
  tipo: TipoSalida;
  formatoId: number;
  ubicacion: UbicacionResumen;
  cantidad: number;
  stockRestante: number;
  observacion: string | null;
  fechaHora: Date;
}

/**
 * Salidas de inventario que no son venta (E11-H3, RF-11.06 y RF-11.11): merma por vencimiento,
 * merma por daño y consumo en la peluquería. El stock se descuenta y el movimiento que lo explica
 * se crea en una misma transacción (RNF-12); el stock nunca queda bajo cero (RNF-13). Si la salida
 * deja el formato bajo su stock mínimo, avisa al personal de bodega y administración (E11-H6).
 */
@Injectable()
export class SalidasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockBajo: StockBajoService,
  ) {}

  /**
   * Descuenta la cantidad del stock del formato en la ubicación y deja un movimiento con el tipo
   * de salida. Si la ubicación no tiene stock suficiente, responde 400 sin cambiar nada. Se admiten
   * formatos y ubicaciones desactivados: su stock físico también puede vencer o dañarse.
   */
  async registrar(
    dto: CrearSalidaDto,
    codigoPublicoUsuario: string,
  ): Promise<SalidaRegistrada> {
    const { salida, avisos } = await this.prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.findUnique({
        where: { codigoPublico: codigoPublicoUsuario },
        select: { id: true },
      });
      if (!usuario) {
        throw new UnauthorizedException('Debes iniciar sesión.');
      }
      await comprobarFormato(tx, dto.formatoId);
      const ubicacion = await ubicacionDe(tx, dto.ubicacionId);
      const stockAntes = await this.stockBajo.stockAntes(tx, dto.formatoId);

      // Atómico (RNF-13): dos salidas simultáneas no dejan el stock bajo cero
      const stockRestante = await descontarExistencia(
        tx,
        { formatoId: dto.formatoId, ubicacionId: dto.ubicacionId },
        dto.cantidad,
        'la salida',
      );
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
        salida: {
          movimientoId: movimiento.id,
          tipo: dto.tipo as TipoSalida,
          formatoId: dto.formatoId,
          ubicacion,
          cantidad: dto.cantidad,
          stockRestante,
          observacion: dto.observacion ?? null,
          fechaHora: movimiento.fechaHora,
        },
        avisos: await this.stockBajo.avisarSiCruza(
          tx,
          dto.formatoId,
          stockAntes,
        ),
      };
    });

    // Después del commit (RNF-12): si Redis no responde, la notificación queda pendiente
    await this.stockBajo.encolar(avisos);
    return salida;
  }
}
