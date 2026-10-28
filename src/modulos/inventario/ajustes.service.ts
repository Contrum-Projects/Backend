import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TIPOS_MOVIMIENTO } from '../../common/dominio/valores.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  comprobarFormato,
  type UbicacionResumen,
  ubicacionDe,
} from './comprobaciones.js';
import type { CrearAjusteDto } from './dto/crear-ajuste.dto.js';
import {
  type ClaveExistencia,
  descontarExistencia,
  stockDe,
  sumarExistencia,
} from './existencias.js';
import { StockBajoService } from './stock-bajo.service.js';

type Tx = Prisma.TransactionClient;
type TipoAjuste =
  | typeof TIPOS_MOVIMIENTO.AJUSTE_POSITIVO
  | typeof TIPOS_MOVIMIENTO.AJUSTE_NEGATIVO;

/** El ajuste tal como lo ve el panel después de registrarlo. */
export interface AjusteRegistrado {
  movimientoId: number;
  tipo: TipoAjuste;
  formatoId: number;
  ubicacion: UbicacionResumen;
  /** La diferencia con signo, como se pidió: +3 sumó, -2 descontó. */
  cantidad: number;
  stockResultante: number;
  observacion: string;
  fechaHora: Date;
}

/**
 * Ajustes de stock (E11-H4, RF-11.07): corrigen la diferencia entre el conteo físico y el stock
 * registrado. El stock y el movimiento de ajuste se escriben en una misma transacción (RNF-12) y
 * el stock nunca queda bajo cero (RNF-13). Si un ajuste negativo deja el formato bajo su stock
 * mínimo, avisa al personal de bodega y administración (E11-H6).
 */
@Injectable()
export class AjustesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockBajo: StockBajoService,
  ) {}

  /**
   * Suma (cantidad positiva) o descuenta (negativa) el stock del formato en la ubicación y deja un
   * movimiento `ajuste_positivo` o `ajuste_negativo` con la cantidad sin signo y el motivo. Se
   * admiten formatos y ubicaciones desactivados: el conteo físico también los alcanza.
   */
  async registrar(
    dto: CrearAjusteDto,
    codigoPublicoUsuario: string,
  ): Promise<AjusteRegistrado> {
    const positivo = dto.cantidad > 0;
    const unidades = Math.abs(dto.cantidad);
    const tipo: TipoAjuste = positivo
      ? TIPOS_MOVIMIENTO.AJUSTE_POSITIVO
      : TIPOS_MOVIMIENTO.AJUSTE_NEGATIVO;
    const clave = { formatoId: dto.formatoId, ubicacionId: dto.ubicacionId };

    const { ajuste, avisos } = await this.prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.findUnique({
        where: { codigoPublico: codigoPublicoUsuario },
        select: { id: true },
      });
      if (!usuario) {
        throw new UnauthorizedException('Debes iniciar sesión.');
      }
      await comprobarFormato(tx, dto.formatoId);
      const ubicacion = await ubicacionDe(tx, dto.ubicacionId);
      // Solo un descuento puede dejar el formato bajo su mínimo
      const stockAntes = positivo
        ? null
        : await this.stockBajo.stockAntes(tx, dto.formatoId);

      const stockResultante = positivo
        ? await this.sumar(tx, clave, unidades)
        : await descontarExistencia(tx, clave, unidades, 'el ajuste');
      const movimiento = await tx.movimientoInventario.create({
        data: {
          formatoId: dto.formatoId,
          // El sentido del ajuste queda también en la ubicación: destino si suma, origen si resta
          ...(positivo
            ? { ubicacionDestinoId: dto.ubicacionId }
            : { ubicacionOrigenId: dto.ubicacionId }),
          usuarioId: usuario.id,
          tipo,
          cantidad: unidades,
          observacion: dto.observacion,
        },
        select: { id: true, fechaHora: true },
      });

      return {
        ajuste: {
          movimientoId: movimiento.id,
          tipo,
          formatoId: dto.formatoId,
          ubicacion,
          cantidad: dto.cantidad,
          stockResultante,
          observacion: dto.observacion,
          fechaHora: movimiento.fechaHora,
        },
        avisos:
          stockAntes === null
            ? []
            : await this.stockBajo.avisarSiCruza(tx, dto.formatoId, stockAntes),
      };
    });

    // Después del commit (RNF-12): si Redis no responde, la notificación queda pendiente
    await this.stockBajo.encolar(avisos);
    return ajuste;
  }

  /** Suma al stock (o crea la existencia); si pasaría el máximo de la columna, 400. */
  private async sumar(tx: Tx, clave: ClaveExistencia, unidades: number) {
    if (!(await sumarExistencia(tx, clave, unidades))) {
      throw new BadRequestException(
        'El stock de ese formato en esa ubicación superaría el máximo permitido.',
      );
    }
    return stockDe(tx, clave);
  }
}
