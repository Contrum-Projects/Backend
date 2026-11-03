import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoVerificacionAprobada,
} from '../../colas/colas.js';
import { encolarCorreos } from '../../colas/encolar-correo.js';
import { ROLES } from '../../common/dominio/roles.js';
import { ESTADOS_SOLICITUD } from '../../common/dominio/valores.js';
import { bloquearCuenta } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  CUENTA_NO_APROBABLE,
  registrarAprobacion,
} from './aprobacion-verificacion.js';
import type { RechazarSolicitudDto } from './dto/rechazar-solicitud.dto.js';

export { CUENTA_NO_APROBABLE };

export const SIN_SOLICITUD_CUENTA =
  'La cuenta no tiene solicitudes de verificación.';
export const NO_ESTA_EN_REVISION =
  'Solo se puede resolver una solicitud en revisión manual.';

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
 * `revision_manual`. Queda guardado quién la resolvió y cuándo. Aprobar deja la cuenta como
 * `profesional` en la misma transacción y encola el correo que lo avisa después del commit (E10-H4).
 *
 * La fila de la cuenta se bloquea antes de leer la solicitud, como al solicitar y al adjuntar
 * documentos: una resolución no se cruza con otra ni con un cambio de la cuenta. El cambio de
 * estado además exige `revision_manual` en la misma sentencia, así que nunca se resuelve dos veces.
 */
@Injectable()
export class RevisionVerificacionService {
  private readonly logger = new Logger(RevisionVerificacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(COLAS.CORREOS) private readonly correos: Queue,
  ) {}

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

  private async resolver(
    codigoPublicoPersonal: string,
    codigoPublicoCuenta: string,
    decision: Decision,
  ): Promise<SolicitudResuelta> {
    const { resuelta, aviso } = await this.prisma.$transaction(async (tx) => {
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

      // E10-H4: el rol y el registro del correo van con la aprobación (RNF-12)
      const aviso: TrabajoVerificacionAprobada | null =
        decision.estado === ESTADOS_SOLICITUD.APROBADA
          ? await registrarAprobacion(tx, cuentaId)
          : null;

      const resuelta: SolicitudResuelta = {
        codigoPublicoCuenta,
        estado: decision.estado,
        fechaSolicitud: solicitud.fechaSolicitud.toISOString(),
        fechaResolucion: fechaResolucion.toISOString(),
        motivoRechazo: decision.motivo,
        resolutor,
      };
      return { resuelta, aviso };
    });

    // Después del commit; con Redis caído la NOTIFICACION queda pendiente y la aprobación no falla
    if (aviso) {
      await encolarCorreos(
        this.correos,
        TRABAJOS_CORREO.VERIFICACION_APROBADA,
        [aviso],
        this.logger,
      );
    }
    return resuelta;
  }
}
