import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ROLES } from '../../common/dominio/roles.js';
import { ESTADOS_SOLICITUD } from '../../common/dominio/valores.js';
import { bloquearCuenta } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { RechazarSolicitudDto } from './dto/rechazar-solicitud.dto.js';

export const SIN_SOLICITUD_CUENTA =
  'La cuenta no tiene solicitudes de verificación.';
export const NO_ESTA_EN_REVISION =
  'Solo se puede resolver una solicitud en revisión manual.';
export const CUENTA_NO_APROBABLE =
  'Solo se puede aprobar la solicitud de una cuenta activa que sigue siendo cliente.';

/** Integrante del personal que resolvió la solicitud. */
export interface ResolutorSolicitud {
  codigoPublico: string;
  nombre: string;
  apellido: string;
}

/** La solicitud recién resuelta, tal como la ve el personal en el panel (E10-H3). */
export interface SolicitudResuelta {
  /** `codigoPublico` de la cuenta que solicitó. */
  codigoPublicoCuenta: string;
  estado: string;
  fechaSolicitud: string;
  fechaResolucion: string;
  /** Solo si fue rechazada. */
  motivoRechazo: string | null;
  resolutor: ResolutorSolicitud;
}

type Decision =
  | { estado: typeof ESTADOS_SOLICITUD.APROBADA; motivo: null }
  | { estado: typeof ESTADOS_SOLICITUD.RECHAZADA; motivo: string };

/**
 * Revisión manual de las solicitudes de verificación por el personal (E10-H3, RF-10.06): aprobar
 * o rechazar con motivo la solicitud más reciente de una cuenta, que debe estar en
 * `revision_manual`. Queda guardado quién la resolvió y cuándo. El rol `profesional` y el correo
 * al aprobar son de E10-H4.
 *
 * La fila de la cuenta se bloquea antes de leer la solicitud, como al solicitar y al adjuntar
 * documentos: una resolución no se cruza con otra ni con un cambio de la cuenta. El cambio de
 * estado además exige `revision_manual` en la misma sentencia, así que nunca se resuelve dos veces.
 */
@Injectable()
export class RevisionVerificacionService {
  constructor(private readonly prisma: PrismaService) {}

  /** E10-H3 · Aprueba la solicitud en revisión manual de la cuenta `codigoPublicoCuenta`. */
  aprobar(
    codigoPublicoPersonal: string,
    codigoPublicoCuenta: string,
  ): Promise<SolicitudResuelta> {
    return this.resolver(codigoPublicoPersonal, codigoPublicoCuenta, {
      estado: ESTADOS_SOLICITUD.APROBADA,
      motivo: null,
    });
  }

  /** E10-H3 · Rechaza con motivo la solicitud en revisión manual de la cuenta. */
  rechazar(
    codigoPublicoPersonal: string,
    codigoPublicoCuenta: string,
    dto: RechazarSolicitudDto,
  ): Promise<SolicitudResuelta> {
    return this.resolver(codigoPublicoPersonal, codigoPublicoCuenta, {
      estado: ESTADOS_SOLICITUD.RECHAZADA,
      motivo: dto.motivo,
    });
  }

  private resolver(
    codigoPublicoPersonal: string,
    codigoPublicoCuenta: string,
    decision: Decision,
  ): Promise<SolicitudResuelta> {
    return this.prisma.$transaction(async (tx) => {
      const cuentaId = await bloquearCuenta(tx, codigoPublicoCuenta);
      const solicitud = await tx.solicitudVerificacion.findFirst({
        where: { solicitanteId: cuentaId },
        orderBy: { id: 'desc' },
        select: { id: true, estado: true, fechaSolicitud: true },
      });
      if (!solicitud) throw new NotFoundException(SIN_SOLICITUD_CUENTA);
      if (solicitud.estado !== ESTADOS_SOLICITUD.REVISION_MANUAL) {
        throw new ConflictException(NO_ESTA_EN_REVISION);
      }
      if (decision.estado === ESTADOS_SOLICITUD.APROBADA) {
        // Aprobar da el precio mayorista (E10-H4): solo a una cuenta activa que sigue siendo
        // cliente. Rechazar no da acceso a nada y se permite siempre.
        const cuenta = await tx.usuario.findUniqueOrThrow({
          where: { id: cuentaId },
          select: { rol: true, activo: true },
        });
        if (!cuenta.activo || cuenta.rol !== ROLES.CLIENTE) {
          throw new ConflictException(CUENTA_NO_APROBABLE);
        }
      }

      const { id: resolutorId, ...resolutor } =
        await tx.usuario.findUniqueOrThrow({
          where: { codigoPublico: codigoPublicoPersonal },
          select: {
            id: true,
            codigoPublico: true,
            nombre: true,
            apellido: true,
          },
        });
      const fechaResolucion = new Date();
      const { count } = await tx.solicitudVerificacion.updateMany({
        where: { id: solicitud.id, estado: ESTADOS_SOLICITUD.REVISION_MANUAL },
        data: {
          estado: decision.estado,
          resolutorId,
          fechaResolucion,
          motivoRechazo: decision.motivo,
        },
      });
      if (count === 0) throw new ConflictException(NO_ESTA_EN_REVISION);

      return {
        codigoPublicoCuenta,
        estado: decision.estado,
        fechaSolicitud: solicitud.fechaSolicitud.toISOString(),
        fechaResolucion: fechaResolucion.toISOString(),
        motivoRechazo: decision.motivo,
        resolutor,
      };
    });
  }
}
