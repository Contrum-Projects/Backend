import { Injectable } from '@nestjs/common';
import { ESTADOS_PEDIDO, TIPOS_PRECIO } from '../../common/dominio/valores.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { validarPeriodo } from './periodo-reporte.js';

/**
 * Un pedido es venta desde que se paga (decisión del 4 nov 2026): quedan fuera los que esperan el
 * pago y los cancelados. Un pedido pagado ya no se cancela (E8-H3).
 */
export const ESTADOS_SIN_VENTA: readonly string[] = [
  ESTADOS_PEDIDO.PENDIENTE_PAGO,
  ESTADOS_PEDIDO.CANCELADO,
];

export interface TotalesVentas {
  pedidos: number;
  montoNeto: number;
  montoIva: number;
  montoTotal: number;
}

export interface ReporteVentas {
  desde: string;
  hasta: string;
  minorista: TotalesVentas;
  mayorista: TotalesVentas;
  total: TotalesVentas;
}

/** Fila de la consulta: PostgreSQL devuelve COUNT y SUM como bigint. */
interface FilaVentas {
  tipoPrecio: string;
  pedidos: bigint;
  montoNeto: bigint;
  montoIva: bigint;
  montoTotal: bigint;
}

const enCero = (): TotalesVentas => ({
  pedidos: 0,
  montoNeto: 0,
  montoIva: 0,
  montoTotal: 0,
});

const sumar = (a: TotalesVentas, b: TotalesVentas): TotalesVentas => ({
  pedidos: a.pedidos + b.pedidos,
  montoNeto: a.montoNeto + b.montoNeto,
  montoIva: a.montoIva + b.montoIva,
  montoTotal: a.montoTotal + b.montoTotal,
});

@Injectable()
export class ReporteVentasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * E14-H2 · Pedidos pagados y sus montos en el período, separados por tipo de cliente. El tipo
   * es el precio que se aplicó al comprar (`detalle_pedido.tipo_precio`, el mismo en todas las
   * líneas): si la cuenta cambia de rol después, sus compras anteriores no cambian de tipo. Los
   * montos son los cerrados del pedido, con el despacho incluido. Sin pedidos, todo en cero.
   */
  async ventasPorTipoCliente(
    desde: string,
    hasta: string,
  ): Promise<ReporteVentas> {
    validarPeriodo(desde, hasta);

    // Los días se cortan a medianoche de Chile: AT TIME ZONE respeta el cambio de horario
    const filas = await this.prisma.$queryRaw<FilaVentas[]>`
      SELECT d.tipo_precio AS "tipoPrecio",
             COUNT(*) AS "pedidos",
             SUM(p.monto_neto) AS "montoNeto",
             SUM(p.monto_iva) AS "montoIva",
             SUM(p.monto_total) AS "montoTotal"
      FROM pedido p
      JOIN LATERAL (
        SELECT dp.tipo_precio FROM detalle_pedido dp
        WHERE dp.id_pedido = p.id_pedido
        LIMIT 1
      ) d ON true
      WHERE p.fecha_pedido >= (${desde}::date)::timestamp AT TIME ZONE 'America/Santiago'
        AND p.fecha_pedido < (${hasta}::date + 1)::timestamp AT TIME ZONE 'America/Santiago'
        AND p.estado_actual <> ALL(${ESTADOS_SIN_VENTA}::text[])
      GROUP BY d.tipo_precio`;

    const minorista = enCero();
    const mayorista = enCero();
    for (const fila of filas) {
      const destino =
        fila.tipoPrecio === TIPOS_PRECIO.MAYORISTA
          ? mayorista
          : fila.tipoPrecio === TIPOS_PRECIO.MINORISTA
            ? minorista
            : null;
      if (!destino) continue;
      destino.pedidos = Number(fila.pedidos);
      destino.montoNeto = Number(fila.montoNeto);
      destino.montoIva = Number(fila.montoIva);
      destino.montoTotal = Number(fila.montoTotal);
    }

    return {
      desde,
      hasta,
      minorista,
      mayorista,
      total: sumar(minorista, mayorista),
    };
  }
}
