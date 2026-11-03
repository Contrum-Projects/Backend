import { ConflictException } from '@nestjs/common';
import type { TrabajoVerificacionAprobada } from '../../colas/colas.js';
import { ROLES } from '../../common/dominio/roles.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import type { Prisma } from '../../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

export const CUENTA_NO_APROBABLE =
  'Solo se puede aprobar la solicitud de una cuenta activa que sigue siendo cliente.';

/** Asunto del diseño «Verificación aprobada» de la página «Correos» de Figma. */
export const ASUNTO_VERIFICACION_APROBADA = 'Tu cuenta profesional está activa';

/**
 * Lo que trae aprobar una solicitud de verificación, sea automática (E10-H1) o manual (E10-H3):
 * la cuenta pasa a `profesional` y queda registrado el correo que lo avisa (E10-H4, RF-10.07 y
 * RF-10.08). Va dentro de la transacción que aprueba la solicitud (RNF-12), con la fila de la
 * cuenta ya bloqueada; el correo se encola después del commit con los datos que devuelve.
 *
 * El cambio de rol exige en la misma sentencia que la cuenta siga activa y sea cliente: el precio
 * mayorista nunca llega a quien no corresponde (RNF-04). Las sesiones abiertas no se revocan: es un
 * ascenso, el token anterior solo da permisos de cliente, y al renovar la sesión el rol se lee de
 * la base (decisión del 3 de noviembre de 2026).
 */
export const registrarAprobacion = async (
  tx: Tx,
  cuentaId: number,
): Promise<TrabajoVerificacionAprobada> => {
  const { count } = await tx.usuario.updateMany({
    where: { id: cuentaId, rol: ROLES.CLIENTE, activo: true },
    data: { rol: ROLES.PROFESIONAL },
  });
  if (count === 0) throw new ConflictException(CUENTA_NO_APROBABLE);

  const cuenta = await tx.usuario.findUniqueOrThrow({
    where: { id: cuentaId },
    select: { email: true, nombre: true },
  });
  const notificacion = await tx.notificacion.create({
    data: {
      usuarioId: cuentaId,
      tipo: TIPOS_NOTIFICACION.VERIFICACION_APROBADA,
      asunto: ASUNTO_VERIFICACION_APROBADA,
      estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
    },
    select: { id: true },
  });
  return {
    notificacionId: notificacion.id,
    destinatario: cuenta.email,
    nombre: cuenta.nombre,
  };
};
