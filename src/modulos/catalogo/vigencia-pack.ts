import { aFechaSinHora } from '../../common/dominio/fechas.js';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Vigencia de un pack (E3-H6): los dos extremos son días incluidos, en hora de Chile, y cada uno
 * es opcional (sin inicio rige desde ya; sin término, para siempre). `hoy` es AAAA-MM-DD.
 */
export const estaVigente = (
  inicio: string | null,
  fin: string | null,
  hoy: string,
) => (inicio === null || inicio <= hoy) && (fin === null || fin >= hoy);

/** La misma regla de `estaVigente` como condición de Prisma, para filtrar en la base. */
export const packVigente = (hoy: string): Prisma.PackWhereInput => {
  const dia = aFechaSinHora(hoy);
  return {
    AND: [
      {
        OR: [
          { fechaInicioVigencia: null },
          { fechaInicioVigencia: { lte: dia } },
        ],
      },
      { OR: [{ fechaFinVigencia: null }, { fechaFinVigencia: { gte: dia } }] },
    ],
  };
};
