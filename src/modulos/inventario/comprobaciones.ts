import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

/** Ubicación tal como la ve el panel en un movimiento. */
export interface UbicacionResumen {
  id: number;
  codigo: string;
  bodega: string;
}

/** El formato existe (activo o no); si no, 400. */
export const comprobarFormato = async (tx: Tx, id: number) => {
  const formato = await tx.formatoProducto.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!formato) {
    throw new BadRequestException('El formato no existe.');
  }
};

/**
 * La ubicación con su bodega; si no existe, 400. Con `activa`, además debe estar activa y ser de
 * una bodega activa: ahí no se puede guardar stock nuevo.
 */
export const ubicacionDe = async (
  tx: Tx,
  id: number,
  { activa = false }: { activa?: boolean } = {},
): Promise<UbicacionResumen> => {
  const ubicacion = await tx.ubicacion.findUnique({
    where: { id },
    select: {
      id: true,
      codigo: true,
      activa: true,
      bodega: { select: { nombre: true, activa: true } },
    },
  });
  if (!ubicacion) {
    throw new BadRequestException('La ubicación no existe.');
  }
  if (activa && (!ubicacion.activa || !ubicacion.bodega.activa)) {
    throw new BadRequestException(
      'La ubicación o su bodega está desactivada: elige otra ubicación.',
    );
  }
  return {
    id: ubicacion.id,
    codigo: ubicacion.codigo,
    bodega: ubicacion.bodega.nombre,
  };
};
