import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';

/** Id de la comuna con ese código CUT; 400 si no existe. */
export const buscarComuna = async (
  tx: Prisma.TransactionClient,
  codigoCut: string,
): Promise<number> => {
  const comuna = await tx.comuna.findUnique({
    where: { codigoCut },
    select: { id: true },
  });
  if (!comuna)
    throw errorDeCampo(BadRequestException, 'La comuna no existe.', 'comuna');
  return comuna.id;
};
