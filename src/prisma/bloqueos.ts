import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

/**
 * Bloqueos de fila y de transacción (RNF-12, RNF-13). Cada uno dura hasta el fin de la
 * transacción. Están todos aquí para que dos módulos que protegen el mismo dato tomen el mismo
 * bloqueo, y para que ningún número de bloqueo de transacción se repita.
 */

/**
 * Bloqueos de transacción (`pg_advisory_xact_lock`) para reglas que abarcan varias filas. Cada
 * número se usa para una sola regla.
 */
export const CANDADOS = {
  /** Nombres de marca únicos sin distinguir mayúsculas (E3-H4). */
  MARCAS: 3401,
  /** Estructura del árbol de categorías, sin ciclos (E3-H4). */
  CATEGORIAS: 3402,
} as const;

export type Candado = (typeof CANDADOS)[keyof typeof CANDADOS];

export const tomarCandado = async (tx: Tx, candado: Candado): Promise<void> => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${candado}::bigint)`;
};

/**
 * Bloquea la fila de la cuenta y devuelve su id. Los cambios de «mi cuenta» que dependen de su
 * estado (una sola dirección principal, el RUT frente a la verificación) y la gestión del
 * personal van de a uno. La aprobación de la verificación (E10) debe tomar este bloqueo antes
 * de leer el RUT.
 */
export const bloquearCuenta = async (
  tx: Tx,
  codigoPublico: string,
  noExiste = 'La cuenta no existe.',
): Promise<number> => {
  const [cuenta] = await tx.$queryRaw<{ id: number }[]>`
    SELECT id_usuario AS id FROM usuario
    WHERE codigo_publico = ${codigoPublico}
    FOR UPDATE`;
  if (!cuenta) throw new NotFoundException(noExiste);
  return cuenta.id;
};

/** Bloquea la fila del artículo de venta (formato o pack): imágenes y precios (E3-H3, E3-H5). */
export const bloquearArticulo = async (tx: Tx, id: number): Promise<void> => {
  const [articulo] = await tx.$queryRaw<{ id: number }[]>`
    SELECT id_articulo AS id FROM articulo_venta
    WHERE id_articulo = ${id}
    FOR UPDATE`;
  if (!articulo) throw new NotFoundException('El artículo no existe.');
};

/**
 * Bloquea la fila del producto: su formato predeterminado (E3-H2) y su canal de venta mientras
 * se fijan precios (E3-H5).
 */
export const bloquearProducto = async (tx: Tx, id: number): Promise<void> => {
  const [producto] = await tx.$queryRaw<{ id: number }[]>`
    SELECT id_producto AS id FROM producto
    WHERE id_producto = ${id}
    FOR UPDATE`;
  if (!producto) throw new NotFoundException('El producto no existe.');
};

/**
 * Bloquea el producto del formato y devuelve su id. Los datos del formato se leen después, con
 * el bloqueo tomado, para ver lo último que guardó otra transacción.
 */
export const bloquearProductoDelFormato = async (
  tx: Tx,
  formatoId: number,
): Promise<number> => {
  const [producto] = await tx.$queryRaw<{ productoId: number }[]>`
    SELECT p.id_producto AS "productoId"
    FROM formato_producto f
    JOIN producto p ON p.id_producto = f.id_producto
    WHERE f.id_formato = ${formatoId}
    FOR UPDATE OF p`;
  if (!producto) throw new NotFoundException('El formato no existe.');
  return producto.productoId;
};

/** Bloquea la fila del pack: su canal de venta mientras se fijan precios (E3-H5). */
export const bloquearPack = async (tx: Tx, id: number): Promise<void> => {
  const [pack] = await tx.$queryRaw<{ id: number }[]>`
    SELECT id_pack AS id FROM pack WHERE id_pack = ${id} FOR UPDATE`;
  if (!pack) throw new NotFoundException('El artículo no existe.');
};
