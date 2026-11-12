import { Injectable } from '@nestjs/common';
import {
  ESTADOS_SIN_VENTA,
  TIPOS_PRECIO,
} from '../../common/dominio/valores.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { armarCsv } from './csv.js';
import { validarPeriodo } from './periodo-reporte.js';

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

/** Un pedido pagado del período, como sale en la exportación (E14-H5). */
export interface VentaPedido {
  codigoPedido: string;
  /** AAAA-MM-DD HH:MI en hora de Chile. */
  fecha: string;
  estado: string;
  tipoCliente: string;
  tipoEntrega: string;
  documento: string;
  montoDescuento: number;
  montoNeto: number;
  montoIva: number;
  montoTotal: number;
}

const ENCABEZADOS_EXPORTACION = [
  'Código pedido',
  'Fecha',
  'Estado',
  'Tipo de cliente',
  'Tipo de entrega',
  'Documento',
  'Descuento',
  'Neto',
  'IVA',
  'Total',
] as const;

/**
 * FROM y WHERE de los pedidos que son venta en el período, con el tipo de cliente de su primera
 * línea (`d.tipo_precio`). Lo comparten el reporte y la exportación para que siempre cuadren.
 * Los días se cortan a medianoche de Chile: AT TIME ZONE respeta el cambio de horario.
 */
const pedidosConVenta = (desde: string, hasta: string) => Prisma.sql`
  FROM pedido p
  JOIN LATERAL (
    SELECT dp.tipo_precio FROM detalle_pedido dp
    WHERE dp.id_pedido = p.id_pedido
    LIMIT 1
  ) d ON true
  WHERE p.fecha_pedido >= (${desde}::date)::timestamp AT TIME ZONE 'America/Santiago'
    AND p.fecha_pedido < (${hasta}::date + 1)::timestamp AT TIME ZONE 'America/Santiago'
    AND p.estado_actual <> ALL(${ESTADOS_SIN_VENTA}::text[])`;

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

    const filas = await this.prisma.$queryRaw<FilaVentas[]>`
      SELECT d.tipo_precio AS "tipoPrecio",
             COUNT(*) AS "pedidos",
             SUM(p.monto_neto) AS "montoNeto",
             SUM(p.monto_iva) AS "montoIva",
             SUM(p.monto_total) AS "montoTotal"
      ${pedidosConVenta(desde, hasta)}
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

  /**
   * E14-H5 (SCRUM-159) · Los mismos pedidos que suma `ventasPorTipoCliente`, uno por fila y del
   * más antiguo al más reciente, para exportarlos. Sin datos personales del comprador: solo el
   * código del pedido. La fecha va en hora de Chile.
   */
  async ventasPorPedido(desde: string, hasta: string): Promise<VentaPedido[]> {
    validarPeriodo(desde, hasta);

    return this.prisma.$queryRaw<VentaPedido[]>`
      SELECT p.codigo_publico AS "codigoPedido",
             to_char(p.fecha_pedido AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD HH24:MI') AS "fecha",
             p.estado_actual AS "estado",
             d.tipo_precio AS "tipoCliente",
             p.tipo_entrega AS "tipoEntrega",
             p.tipo_documento_solicitado AS "documento",
             p.monto_descuento AS "montoDescuento",
             p.monto_neto AS "montoNeto",
             p.monto_iva AS "montoIva",
             p.monto_total AS "montoTotal"
      ${pedidosConVenta(desde, hasta)}
      ORDER BY p.fecha_pedido, p.id_pedido`;
  }

  /** E14-H5 · El CSV de `ventasPorPedido`, con encabezados en español. */
  async exportarVentas(desde: string, hasta: string): Promise<string> {
    const pedidos = await this.ventasPorPedido(desde, hasta);
    return armarCsv(
      ENCABEZADOS_EXPORTACION,
      pedidos.map((p) => [
        p.codigoPedido,
        p.fecha,
        p.estado,
        p.tipoCliente,
        p.tipoEntrega,
        p.documento,
        p.montoDescuento,
        p.montoNeto,
        p.montoIva,
        p.montoTotal,
      ]),
    );
  }
}
