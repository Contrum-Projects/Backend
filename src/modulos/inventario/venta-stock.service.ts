import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { TrabajoStockBajo } from '../../colas/colas.js';
import {
  TIPOS_ARTICULO,
  TIPOS_MOVIMIENTO,
} from '../../common/dominio/valores.js';
import { MAXIMO_INT4 } from '../../common/validacion/enteros.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { EXISTENCIA_VENDIBLE } from '../catalogo/disponibilidad.js';
import { sumarExistencia } from './existencias.js';
import { StockBajoService } from './stock-bajo.service.js';

type Tx = Prisma.TransactionClient;

/** Un artículo del pedido (formato o pack) y cuántas unidades lleva. */
export interface LineaVenta {
  articuloId: number;
  cantidad: number;
}

/** Unidades de un formato que salieron de, o volvieron a, una ubicación por un pedido. */
export interface MovimientoPedido {
  formatoId: number;
  ubicacionId: number;
  cantidad: number;
}

/**
 * Resultado del descuento: lo que salió de cada ubicación y los correos de stock bajo. Es interno:
 * lleva ubicaciones, stock y correos del personal, así que nunca va en la respuesta al comprador.
 */
export interface DescuentoVenta {
  descuentos: MovimientoPedido[];
  /** Encólalos con `encolarAvisos` después del commit (RNF-12). */
  avisos: TrabajoStockBajo[];
}

/**
 * Stock de la venta (E11-H7, RF-11.09, RF-11.10 y RF-11.14). No tiene rutas: lo llaman la
 * creación del pedido (E5) y su cancelación (E6 y E8) dentro de su propia transacción, para que
 * el pedido y sus movimientos se escriban juntos (RNF-12).
 *
 * La venta descuenta solo stock vendible (ubicaciones activas de bodegas activas que abastecen la
 * venta online), el mismo que la tienda muestra como disponible, siguiendo el orden del código de
 * ubicación. Un pack descuenta de sus formatos componentes. La cancelación devuelve las unidades a
 * las mismas ubicaciones de donde salieron.
 */
@Injectable()
export class VentaStockService {
  constructor(private readonly stockBajo: StockBajoService) {}

  /**
   * Descuenta del stock las unidades del pedido y deja un movimiento `venta` por formato y
   * ubicación ligado al pedido. Si algún formato no tiene stock vendible suficiente responde 409;
   * quien llama debe dejar que la transacción se revierta completa.
   */
  async descontarPorPedido(
    tx: Tx,
    pedidoId: number,
    lineas: LineaVenta[],
  ): Promise<DescuentoVenta> {
    const unidades = await unidadesPorFormato(tx, lineas);
    const descuentos: MovimientoPedido[] = [];
    const avisos: TrabajoStockBajo[] = [];

    // Los formatos en orden de id: dos pedidos con los mismos formatos los bloquean en el mismo
    // orden y no se esperan uno al otro para siempre
    for (const [formatoId, cantidad] of [...unidades].sort(
      ([a], [b]) => a - b,
    )) {
      const stockAntes = await this.stockBajo.stockAntes(tx, formatoId);
      descuentos.push(
        ...(await descontarFormato(tx, pedidoId, formatoId, cantidad)),
      );
      avisos.push(
        ...(await this.stockBajo.avisarSiCruza(tx, formatoId, stockAntes)),
      );
    }
    return { descuentos, avisos };
  }

  /**
   * Devuelve al stock lo que el pedido descontó y aún no se reingresó, a la misma ubicación de
   * donde salió (aunque se haya desactivado después: es stock físico que vuelve a su lugar), con
   * un movimiento `reingreso`. `usuarioId` es quien cancela, o `null` si la cancelación es
   * automática. Llamarlo otra vez no reingresa dos veces.
   */
  async reingresarPorPedido(
    tx: Tx,
    pedidoId: number,
    usuarioId: number | null,
  ): Promise<MovimientoPedido[]> {
    // Dos cancelaciones simultáneas del mismo pedido se ordenan: la segunda ve lo ya reingresado
    await tx.$queryRaw`
      SELECT id_pedido FROM pedido WHERE id_pedido = ${pedidoId} FOR NO KEY UPDATE`;

    const reingresos = await pendientesDeReingreso(tx, pedidoId);
    for (const { formatoId, ubicacionId, cantidad } of reingresos) {
      const sumado = await sumarExistencia(
        tx,
        { formatoId, ubicacionId },
        cantidad,
      );
      if (!sumado) {
        throw new ConflictException(
          'No se pudo devolver el stock del pedido: la ubicación superaría el máximo permitido.',
        );
      }
      await tx.movimientoInventario.create({
        data: {
          formatoId,
          ubicacionDestinoId: ubicacionId,
          pedidoId,
          usuarioId,
          tipo: TIPOS_MOVIMIENTO.REINGRESO,
          cantidad,
        },
      });
    }
    return reingresos;
  }

  /** Encola los correos de stock bajo de la venta; llámalo después del commit. */
  encolarAvisos(avisos: TrabajoStockBajo[]): Promise<void> {
    return this.stockBajo.encolar(avisos);
  }
}

/**
 * Unidades de cada formato que lleva el pedido: un pack se convierte en sus componentes
 * (cantidad del componente × packs) y un formato que llega suelto y en un pack se suma.
 */
const unidadesPorFormato = async (
  tx: Tx,
  lineas: LineaVenta[],
): Promise<Map<number, number>> => {
  // El servicio se exporta: no confía solo en el DTO de quien llama. Una cantidad negativa
  // sumaría stock en vez de descontarlo
  if (
    lineas.some((l) => !Number.isSafeInteger(l.cantidad) || l.cantidad <= 0)
  ) {
    throw new BadRequestException(
      'Cada artículo del pedido debe llevar una cantidad entera mayor que 0.',
    );
  }
  const articulos = await tx.articuloVenta.findMany({
    where: { id: { in: lineas.map((l) => l.articuloId) } },
    select: {
      id: true,
      tipo: true,
      pack: {
        select: {
          componentes: { select: { formatoId: true, cantidad: true } },
        },
      },
    },
  });
  const porId = new Map(articulos.map((a) => [a.id, a]));

  const unidades = new Map<number, number>();
  const sumar = (formatoId: number, cantidad: number) =>
    unidades.set(formatoId, (unidades.get(formatoId) ?? 0) + cantidad);

  for (const { articuloId, cantidad } of lineas) {
    const articulo = porId.get(articuloId);
    const esPack = articulo?.tipo === TIPOS_ARTICULO.PACK;
    // Un pack sin su fila o sin componentes no tiene stock que descontar: no se vende
    if (!articulo || (esPack && !articulo.pack?.componentes.length)) {
      throw new ConflictException('Un artículo del pedido ya no existe.');
    }
    if (esPack && articulo.pack) {
      for (const componente of articulo.pack.componentes) {
        sumar(componente.formatoId, componente.cantidad * cantidad);
      }
    } else {
      sumar(articulo.id, cantidad);
    }
  }
  if ([...unidades.values()].some((total) => total > MAXIMO_INT4)) {
    throw new BadRequestException(
      'El pedido lleva más unidades de las permitidas.',
    );
  }
  return unidades;
};

/**
 * Descuenta las unidades del formato de sus ubicaciones vendibles, agotando cada una en el orden
 * de su código antes de pasar a la siguiente.
 */
const descontarFormato = async (
  tx: Tx,
  pedidoId: number,
  formatoId: number,
  cantidad: number,
): Promise<MovimientoPedido[]> => {
  // Bloquea las existencias del formato en orden de id de ubicación, el mismo que usan las
  // transferencias, para que el stock leído no cambie hasta el commit (RNF-13) sin deadlocks
  await tx.$queryRaw`
    SELECT id_ubicacion FROM existencia
    WHERE id_formato = ${formatoId}
    ORDER BY id_ubicacion
    FOR UPDATE`;
  const existencias = await tx.existencia.findMany({
    where: { formatoId, cantidad: { gt: 0 }, ...EXISTENCIA_VENDIBLE },
    orderBy: [{ ubicacion: { codigo: 'asc' } }, { ubicacionId: 'asc' }],
    select: { ubicacionId: true, cantidad: true },
  });
  const vendible = existencias.reduce((total, e) => total + e.cantidad, 0);
  if (vendible < cantidad) {
    throw await sinStock(tx, formatoId);
  }

  const descuentos: MovimientoPedido[] = [];
  let pendiente = cantidad;
  for (const { ubicacionId, cantidad: hay } of existencias) {
    if (pendiente === 0) break;
    const toma = Math.min(pendiente, hay);
    // Condición atómica de todas formas (RNF-13): nunca bajo cero
    const { count } = await tx.existencia.updateMany({
      where: { formatoId, ubicacionId, cantidad: { gte: toma } },
      data: { cantidad: { decrement: toma } },
    });
    if (count === 0) {
      throw await sinStock(tx, formatoId);
    }
    await tx.movimientoInventario.create({
      data: {
        formatoId,
        ubicacionOrigenId: ubicacionId,
        pedidoId,
        tipo: TIPOS_MOVIMIENTO.VENTA,
        cantidad: toma,
      },
    });
    descuentos.push({ formatoId, ubicacionId, cantidad: toma });
    pendiente -= toma;
  }
  return descuentos;
};

/** 409 que nombra el producto y el formato, sin revelar cuántas unidades hay (como la tienda). */
const sinStock = async (tx: Tx, formatoId: number) => {
  const formato = await tx.formatoProducto.findUnique({
    where: { id: formatoId },
    select: { nombreFormato: true, producto: { select: { nombre: true } } },
  });
  const nombre = formato
    ? `${formato.producto.nombre} ${formato.nombreFormato}`
    : 'un artículo del pedido';
  return new ConflictException(`No hay stock suficiente de ${nombre}.`);
};

/**
 * Lo vendido por el pedido menos lo ya reingresado, por formato y ubicación, en orden de formato
 * y de ubicación (los bloqueos de las existencias, siempre en el mismo orden).
 */
const pendientesDeReingreso = async (
  tx: Tx,
  pedidoId: number,
): Promise<MovimientoPedido[]> => {
  const [vendido, reingresado] = await Promise.all([
    tx.movimientoInventario.groupBy({
      by: ['formatoId', 'ubicacionOrigenId'],
      where: { pedidoId, tipo: TIPOS_MOVIMIENTO.VENTA },
      _sum: { cantidad: true },
    }),
    tx.movimientoInventario.groupBy({
      by: ['formatoId', 'ubicacionDestinoId'],
      where: { pedidoId, tipo: TIPOS_MOVIMIENTO.REINGRESO },
      _sum: { cantidad: true },
    }),
  ]);
  const clave = (formatoId: number, ubicacionId: number | null) =>
    `${formatoId}:${ubicacionId}`;
  const yaDevuelto = new Map(
    reingresado.map((r) => [
      clave(r.formatoId, r.ubicacionDestinoId),
      r._sum.cantidad ?? 0,
    ]),
  );

  return vendido
    .flatMap(({ formatoId, ubicacionOrigenId, _sum }) => {
      if (ubicacionOrigenId === null) return [];
      const cantidad =
        (_sum.cantidad ?? 0) -
        (yaDevuelto.get(clave(formatoId, ubicacionOrigenId)) ?? 0);
      return cantidad > 0
        ? [{ formatoId, ubicacionId: ubicacionOrigenId, cantidad }]
        : [];
    })
    .sort((a, b) => a.formatoId - b.formatoId || a.ubicacionId - b.ubicacionId);
};
