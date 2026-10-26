import { DISPONIBILIDADES, type Valor } from '../../common/dominio/valores.js';
import type { Prisma } from '../../generated/prisma/client.js';

export type Disponibilidad = Valor<typeof DISPONIBILIDADES>;

/** Cliente de Prisma o de una transacción: el pedido (E5) lo leerá dentro de la suya. */
type LectorExistencias = Pick<Prisma.TransactionClient, 'existencia'>;

/**
 * Stock que se puede vender en la tienda (E2-H3): solo el de ubicaciones activas de bodegas
 * activas que abastecen la venta online (decisión del 26 oct).
 */
export const EXISTENCIA_VENDIBLE = {
  ubicacion: {
    activa: true,
    bodega: { activa: true, abasteceVentaOnline: true },
  },
} satisfies Prisma.ExistenciaWhereInput;

/** Unidades vendibles de cada formato; un formato sin existencias no aparece (vale 0). */
export const stockVendible = async (
  prisma: LectorExistencias,
  formatoIds: number[],
): Promise<Map<number, number>> => {
  if (formatoIds.length === 0) {
    return new Map();
  }
  const filas = await prisma.existencia.groupBy({
    by: ['formatoId'],
    where: { formatoId: { in: formatoIds }, ...EXISTENCIA_VENDIBLE },
    _sum: { cantidad: true },
  });
  return new Map(
    filas.map((fila) => [fila.formatoId, fila._sum.cantidad ?? 0]),
  );
};

/** Unidades vendibles de un formato según el resultado de `stockVendible`. */
export const unidadesDeFormato = (
  stock: Map<number, number>,
  formatoId: number,
) => stock.get(formatoId) ?? 0;

/**
 * Packs completos que se pueden armar (E2-H3, criterio 3): manda el componente más escaso,
 * contando cuántas unidades de cada formato lleva el pack.
 */
export const unidadesDePack = (
  componentes: { formatoId: number; cantidad: number }[],
  stock: Map<number, number>,
) => {
  if (componentes.length === 0) {
    return 0;
  }
  return Math.min(
    ...componentes.map(({ formatoId, cantidad }) =>
      Math.floor(unidadesDeFormato(stock, formatoId) / cantidad),
    ),
  );
};

/**
 * Lo que ve la tienda: disponible con al menos una unidad, agotado si no. El carrito y el
 * pedido (E5) deben rechazar un artículo agotado con esta misma regla (criterio 2).
 */
export const disponibilidad = (unidades: number): Disponibilidad =>
  unidades >= 1 ? DISPONIBILIDADES.DISPONIBLE : DISPONIBILIDADES.AGOTADO;
