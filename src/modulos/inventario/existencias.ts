import { BadRequestException } from '@nestjs/common';
import { MAXIMO_INT4 } from '../../common/validacion/enteros.js';
import type { Prisma } from '../../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

/** Stock de un formato en una ubicación (la clave de EXISTENCIA). */
export interface ClaveExistencia {
  formatoId: number;
  ubicacionId: number;
}

/**
 * Suma unidades a la existencia del formato en la ubicación, o la crea, en una sola sentencia
 * atómica: dos movimientos simultáneos del mismo formato suman los dos (RNF-13). Devuelve `false`
 * si la suma pasaría el máximo de la columna (int4); entonces no cambia nada.
 */
export const sumarExistencia = async (
  tx: Tx,
  { formatoId, ubicacionId }: ClaveExistencia,
  cantidad: number,
): Promise<boolean> => {
  const filas = await tx.$executeRaw`
    INSERT INTO existencia (id_formato, id_ubicacion, cantidad, fecha_actualizacion)
    VALUES (${formatoId}, ${ubicacionId}, ${cantidad}, now())
    ON CONFLICT (id_formato, id_ubicacion) DO UPDATE
    SET cantidad = existencia.cantidad + EXCLUDED.cantidad,
        fecha_actualizacion = now()
    WHERE existencia.cantidad::bigint + EXCLUDED.cantidad <= ${MAXIMO_INT4}`;
  return filas === 1;
};

/**
 * Descuenta con una condición atómica (`cantidad >= n`), sin leer antes: dos descuentos
 * simultáneos no pueden dejar el stock bajo cero (RNF-13). Si no alcanza, responde 400 con
 * cuánto hay, nombrando la operación («la salida», «el ajuste»). Devuelve el stock que queda.
 */
export const descontarExistencia = async (
  tx: Tx,
  clave: ClaveExistencia,
  cantidad: number,
  operacion: string,
): Promise<number> => {
  const { count } = await tx.existencia.updateMany({
    where: { ...clave, cantidad: { gte: cantidad } },
    data: { cantidad: { decrement: cantidad } },
  });
  const disponible = await stockDe(tx, clave);
  if (count === 0) {
    throw new BadRequestException(
      `No hay stock suficiente en esa ubicación: hay ${disponible} y ${operacion} es de ${cantidad}.`,
    );
  }
  return disponible;
};

/** Stock actual del formato en la ubicación; sin existencia, 0. */
export const stockDe = async (tx: Tx, clave: ClaveExistencia) =>
  (
    await tx.existencia.findUnique({
      where: { formatoId_ubicacionId: clave },
      select: { cantidad: true },
    })
  )?.cantidad ?? 0;
