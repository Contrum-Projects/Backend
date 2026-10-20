import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Bloquea la fila de la cuenta hasta el fin de la transacción y devuelve su id (RNF-12). Los
 * cambios de «mi cuenta» que dependen de su estado (una sola dirección principal, el RUT frente a
 * la verificación) van de a uno. La aprobación de la verificación (E10) debe tomar el mismo
 * bloqueo antes de leer el RUT.
 */
export const bloquearCuenta = async (
  tx: Prisma.TransactionClient,
  codigoPublico: string,
): Promise<number> => {
  const [cuenta] = await tx.$queryRaw<{ id: number }[]>`
    SELECT id_usuario AS id FROM usuario
    WHERE codigo_publico = ${codigoPublico}
    FOR UPDATE`;
  if (!cuenta) throw new NotFoundException('La cuenta no existe.');
  return cuenta.id;
};
