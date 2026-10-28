import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoStockBajo,
} from '../../colas/colas.js';
import { encolarCorreos } from '../../colas/encolar-correo.js';
import { ROLES } from '../../common/dominio/roles.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

type Tx = Prisma.TransactionClient;

const LARGO_ASUNTO = 200;

/** Un formato con su stock total bajo el mínimo, tal como lo ve el panel. */
export interface FormatoBajoMinimo {
  formatoId: number;
  sku: string;
  producto: string;
  nombreFormato: string;
  activo: boolean;
  stockMinimo: number;
  stockTotal: number;
  /** Unidades que faltan para llegar al mínimo. */
  faltante: number;
}

interface FilaBajoMinimo {
  formatoId: number;
  sku: string;
  producto: string;
  nombreFormato: string;
  activo: boolean;
  stockMinimo: number;
  stockTotal: bigint;
}

/**
 * Aviso de stock bajo el mínimo (E11-H6, RF-11.15 y RF-11.16). El stock que se compara es el
 * total del formato en todas sus ubicaciones. Cuando un movimiento lo hace pasar de igual o
 * sobre el mínimo a bajo el mínimo, se crea una NOTIFICACION por cada bodeguero y administrador
 * activo con el correo confirmado, en la misma transacción del movimiento (RNF-12), y los correos
 * se encolan después del commit. El aviso del panel se calcula al consultar: desaparece solo al
 * reponer.
 */
@Injectable()
export class StockBajoService {
  private readonly logger = new Logger(StockBajoService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(COLAS.CORREOS) private readonly correos: Queue,
  ) {}

  /**
   * Bloquea la fila del formato hasta el fin de la transacción y devuelve su stock total antes
   * del movimiento. Con el bloqueo, dos descuentos simultáneos del mismo formato se ordenan y
   * solo uno de ellos ve el cruce del mínimo: el correo no se repite ni se pierde.
   */
  async stockAntes(tx: Tx, formatoId: number): Promise<number> {
    // NO KEY UPDATE, no UPDATE: convive con el KEY SHARE que toman los INSERT con llave foránea
    // al formato (movimientos, existencias) de transferencias y entradas, y así no hay deadlock
    await tx.$queryRaw`
      SELECT id_formato FROM formato_producto WHERE id_formato = ${formatoId} FOR NO KEY UPDATE`;
    return stockTotal(tx, formatoId);
  }

  /**
   * Después del movimiento: si el stock total cruzó el mínimo (antes igual o sobre, ahora bajo),
   * crea las notificaciones pendientes y devuelve los correos para encolar después del commit.
   * Si no cruzó (sigue igual o sobre, o ya estaba bajo), no crea nada.
   */
  async avisarSiCruza(
    tx: Tx,
    formatoId: number,
    stockAntes: number,
  ): Promise<TrabajoStockBajo[]> {
    const formato = await tx.formatoProducto.findUnique({
      where: { id: formatoId },
      select: {
        stockMinimo: true,
        nombreFormato: true,
        articulo: { select: { sku: true } },
        producto: { select: { nombre: true } },
      },
    });
    if (!formato) return [];
    const { stockMinimo } = formato;
    const despues = await stockTotal(tx, formatoId);
    if (stockAntes < stockMinimo || despues >= stockMinimo) return [];

    const destinatarios = await tx.usuario.findMany({
      where: {
        rol: { in: [ROLES.BODEGUERO, ROLES.ADMINISTRADOR] },
        activo: true,
        fechaVerificacionCorreo: { not: null },
      },
      select: { id: true, email: true, nombre: true },
      orderBy: { id: 'asc' },
    });
    if (destinatarios.length === 0) {
      this.logger.warn(
        `El formato ${formatoId} quedó bajo su stock mínimo y no hay personal de bodega ni de administración a quien avisar.`,
      );
      return [];
    }

    const asunto =
      `Stock bajo el mínimo: ${formato.producto.nombre} ${formato.nombreFormato}`.slice(
        0,
        LARGO_ASUNTO,
      );
    const notificaciones = await tx.notificacion.createManyAndReturn({
      data: destinatarios.map(({ id }) => ({
        usuarioId: id,
        tipo: TIPOS_NOTIFICACION.STOCK_BAJO,
        asunto,
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
      })),
      select: { id: true, usuarioId: true },
    });
    const idPorUsuario = new Map(
      notificaciones.map((n) => [n.usuarioId, n.id]),
    );

    return destinatarios.map((destinatario) => ({
      notificacionId: idPorUsuario.get(destinatario.id) as number,
      destinatario: destinatario.email,
      nombre: destinatario.nombre,
      formato: {
        id: formatoId,
        sku: formato.articulo.sku,
        producto: formato.producto.nombre,
        nombreFormato: formato.nombreFormato,
      },
      stockTotal: despues,
      stockMinimo,
    }));
  }

  /**
   * Encola los correos de stock bajo en una sola operación; llámalo después del commit. Con
   * Redis caído espera un único plazo, no uno por destinatario.
   */
  encolar(trabajos: TrabajoStockBajo[]): Promise<void> {
    return encolarCorreos(
      this.correos,
      TRABAJOS_CORREO.STOCK_BAJO,
      trabajos,
      this.logger,
    );
  }

  /**
   * Aviso del panel: formatos con mínimo definido (> 0) y stock total bajo él, del que más
   * falta al que menos. Solo lectura desde PostgreSQL, sin caché.
   */
  async listarBajoMinimo(): Promise<FormatoBajoMinimo[]> {
    const filas = await this.prisma.$queryRaw<FilaBajoMinimo[]>`
      SELECT f.id_formato AS "formatoId",
             a.sku,
             p.nombre AS producto,
             f.nombre_formato AS "nombreFormato",
             a.activo,
             f.stock_minimo AS "stockMinimo",
             COALESCE(SUM(e.cantidad), 0)::bigint AS "stockTotal"
      FROM formato_producto f
      JOIN articulo_venta a ON a.id_articulo = f.id_formato
      JOIN producto p ON p.id_producto = f.id_producto
      LEFT JOIN existencia e ON e.id_formato = f.id_formato
      WHERE f.stock_minimo > 0
      GROUP BY f.id_formato, a.id_articulo, p.id_producto
      HAVING COALESCE(SUM(e.cantidad), 0) < f.stock_minimo
      ORDER BY f.stock_minimo - COALESCE(SUM(e.cantidad), 0) DESC, f.id_formato`;

    return filas.map((fila) => {
      const total = Number(fila.stockTotal);
      return {
        ...fila,
        stockTotal: total,
        faltante: fila.stockMinimo - total,
      };
    });
  }
}

/** Stock total del formato: la suma de sus existencias en todas las ubicaciones. */
const stockTotal = async (tx: Tx, formatoId: number) =>
  (
    await tx.existencia.aggregate({
      where: { formatoId },
      _sum: { cantidad: true },
    })
  )._sum.cantidad ?? 0;
