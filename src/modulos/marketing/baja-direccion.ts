import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Deja una dirección sin publicidad, como la baja desde el correo (E12-H2): la suscripción sin
 * cuenta queda de baja con esta fecha aunque estuviera pendiente o ya de baja (ningún enlace de
 * confirmación anterior la activa) y la cuenta deja de aceptar ofertas, conservando la fecha de su
 * último consentimiento. La usa el rebote (E12-H6), dentro de su transacción. `email` en
 * minúsculas, como se guardan ambas.
 */
export const darDeBajaDireccion = async (
  tx: Prisma.TransactionClient,
  email: string,
  fecha: Date,
): Promise<void> => {
  await tx.lead.updateMany({
    where: { email },
    data: { activo: false, fechaBaja: fecha },
  });
  await tx.usuario.updateMany({
    where: { email, aceptaMarketingEmail: true },
    data: { aceptaMarketingEmail: false },
  });
};
