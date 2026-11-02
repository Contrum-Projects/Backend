import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { hoyEnLaTienda } from '../../common/dominio/fechas.js';
import { ROLES } from '../../common/dominio/roles.js';
import {
  ESTADOS_SOLICITUD,
  RESULTADOS_CONSULTA_SII,
} from '../../common/dominio/valores.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { bloquearCuenta } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { evaluarSituacion } from './sii/evaluar-situacion.js';
import { ProveedorSituacionTributaria } from './sii/proveedor-situacion-tributaria.js';

export const YA_ES_PROFESIONAL = 'Tu cuenta ya es profesional.';
export const SIN_RUT =
  'Registra tu RUT en tus datos antes de solicitar la verificación.';
export const SOLICITUD_EN_CURSO =
  'Ya tienes una solicitud de verificación en curso.';
export const YA_APROBADA = 'Tu verificación ya fue aprobada.';
export const DATOS_CAMBIARON =
  'Tus datos cambiaron mientras verificábamos. Intenta de nuevo.';
export const SIN_SOLICITUD = 'No tienes solicitudes de verificación.';

/**
 * La solicitud de verificación de la cuenta (E10-H1). Lo que dijo el SII, los giros, el
 * proveedor, el puntaje y quién la resolvió son del personal y no salen: quien solicita solo ve
 * en qué quedó y si debe adjuntar documentos.
 */
export interface SolicitudVerificacionCuenta {
  estado: string;
  fechaSolicitud: string;
  fechaResolucion: string | null;
  /** Solo si fue rechazada. */
  motivoRechazo: string | null;
  /**
   * `true` si la verificación automática no la aprobó y falta que adjunte documentos (E10-H2): es
   * lo que significa `pendiente`. Con documentos enviados pasa a `revision_manual`.
   */
  requiereDocumentos: boolean;
}

/**
 * Estados con los que no se puede enviar otra solicitud: la abierta (`pendiente` o
 * `revision_manual`) y la aprobada, que deja de ser cliente apenas se registra (E10-H4). Solo tras
 * un rechazo se puede volver a solicitar.
 */
const ESTADOS_QUE_BLOQUEAN: string[] = [
  ESTADOS_SOLICITUD.PENDIENTE,
  ESTADOS_SOLICITUD.REVISION_MANUAL,
  ESTADOS_SOLICITUD.APROBADA,
];

const SELECCION_SOLICITUD = {
  estado: true,
  fechaSolicitud: true,
  fechaResolucion: true,
  motivoRechazo: true,
} satisfies Prisma.SolicitudVerificacionSelect;

type SolicitudLeida = Prisma.SolicitudVerificacionGetPayload<{
  select: typeof SELECCION_SOLICITUD;
}>;

const SELECCION_CUENTA = {
  id: true,
  rol: true,
  rut: true,
  solicitudesPresentadas: {
    where: { estado: { in: ESTADOS_QUE_BLOQUEAN } },
    select: { estado: true },
    take: 1,
  },
} satisfies Prisma.UsuarioSelect;

type CuentaLeida = Prisma.UsuarioGetPayload<{
  select: typeof SELECCION_CUENTA;
}>;

/** Lo que dejó la consulta al SII, listo para guardarse en la solicitud. */
interface ConsultaRealizada {
  fecha: Date;
  resultado: string;
  giros:
    { codigo: string; nombre: string; fechaInicio: string | null }[] | null;
  operacion: string | null;
}

/**
 * Solicitud de verificación como profesional (E10-H1, RF-10.01, RF-10.04, RF-10.05 y RF-10.09).
 * Al solicitar se consulta el inicio de actividades del RUT en el SII: con el giro 960200 vigente
 * la solicitud queda `aprobada` sola; con cualquier otro resultado, o si la consulta falla, queda
 * `pendiente` a la espera de documentos (E10-H2). El sistema nunca rechaza solo (RNF-27). El rol
 * de la cuenta y el correo de aprobación son de E10-H4.
 *
 * La consulta es una llamada externa de hasta 10 segundos: se hace antes de la transacción, sin
 * tener la cuenta bloqueada. La fila de la cuenta se bloquea al registrar, como al editar el RUT:
 * dos envíos a la vez no dejan dos solicitudes abiertas, y el RUT consultado es el que queda.
 */
@Injectable()
export class SolicitudVerificacionService {
  private readonly logger = new Logger(SolicitudVerificacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly proveedor: ProveedorSituacionTributaria,
  ) {}

  async solicitar(codigoPublico: string): Promise<SolicitudVerificacionCuenta> {
    // Revisión previa para no pagar una consulta que no se va a poder registrar
    const previa = await this.prisma.usuario.findUnique({
      where: { codigoPublico },
      select: SELECCION_CUENTA,
    });
    if (!previa) throw new NotFoundException('La cuenta no existe.');
    exigirPuedeSolicitar(previa);

    const consulta = await this.consultar(previa.rut as string);

    const solicitud = await this.prisma.$transaction(async (tx) => {
      await bloquearCuenta(tx, codigoPublico);
      const cuenta = await tx.usuario.findUniqueOrThrow({
        where: { id: previa.id },
        select: SELECCION_CUENTA,
      });
      exigirPuedeSolicitar(cuenta);
      if (cuenta.rut !== previa.rut)
        throw new ConflictException(DATOS_CAMBIARON);

      const aprobada = consulta.resultado === RESULTADOS_CONSULTA_SII.APROBADO;
      return tx.solicitudVerificacion.create({
        data: {
          solicitanteId: cuenta.id,
          estado: aprobada
            ? ESTADOS_SOLICITUD.APROBADA
            : ESTADOS_SOLICITUD.PENDIENTE,
          // La aprobó el sistema: no hay personal que la resolviera
          fechaResolucion: aprobada ? consulta.fecha : null,
          fechaConsultaSii: consulta.fecha,
          resultadoConsultaSii: consulta.resultado,
          girosSii: consulta.giros ?? undefined,
          proveedorConsultaSii: this.proveedor.nombre,
          operacionConsultaSii: consulta.operacion,
        },
        select: SELECCION_SOLICITUD,
      });
    });
    return aSolicitudCuenta(solicitud);
  }

  /** La solicitud más reciente de la cuenta, con su estado y, si la rechazaron, el motivo. */
  async verMiSolicitud(
    codigoPublico: string,
  ): Promise<SolicitudVerificacionCuenta> {
    const solicitud = await this.prisma.solicitudVerificacion.findFirst({
      where: { solicitante: { codigoPublico } },
      orderBy: { id: 'desc' },
      select: SELECCION_SOLICITUD,
    });
    if (!solicitud) throw new NotFoundException(SIN_SOLICITUD);
    return aSolicitudCuenta(solicitud);
  }

  /**
   * Consulta el RUT al SII. Si no se puede, no bloquea a nadie (E10-H1): se registra la falla, sin
   * el RUT, y la solicitud sigue por los documentos.
   */
  private async consultar(rut: string): Promise<ConsultaRealizada> {
    const fecha = new Date();
    try {
      const situacion = await this.proveedor.consultar(rut);
      return {
        fecha,
        resultado: evaluarSituacion(
          situacion.actividades,
          hoyEnLaTienda(fecha),
        ),
        giros: situacion.actividades.map(({ codigo, nombre, fechaInicio }) => ({
          codigo,
          nombre,
          fechaInicio,
        })),
        operacion: situacion.operacion,
      };
    } catch (error) {
      this.logger.warn(
        `La consulta al SII no se pudo hacer (${this.proveedor.nombre}): ${(error as Error).message}`,
      );
      return {
        fecha,
        resultado: RESULTADOS_CONSULTA_SII.NO_DISPONIBLE,
        giros: null,
        operacion: null,
      };
    }
  }
}

/** Quién puede enviar la solicitud. Se revisa antes de consultar y de nuevo con la cuenta bloqueada. */
const exigirPuedeSolicitar = (cuenta: CuentaLeida) => {
  if (cuenta.rol === ROLES.PROFESIONAL) {
    throw new ConflictException(YA_ES_PROFESIONAL);
  }
  if (cuenta.rut === null) throw new ConflictException(SIN_RUT);
  const [bloqueante] = cuenta.solicitudesPresentadas;
  if (bloqueante?.estado === ESTADOS_SOLICITUD.APROBADA) {
    throw new ConflictException(YA_APROBADA);
  }
  if (bloqueante) throw new ConflictException(SOLICITUD_EN_CURSO);
};

const aSolicitudCuenta = (
  solicitud: SolicitudLeida,
): SolicitudVerificacionCuenta => ({
  estado: solicitud.estado,
  fechaSolicitud: solicitud.fechaSolicitud.toISOString(),
  fechaResolucion: solicitud.fechaResolucion?.toISOString() ?? null,
  motivoRechazo:
    solicitud.estado === ESTADOS_SOLICITUD.RECHAZADA
      ? solicitud.motivoRechazo
      : null,
  requiereDocumentos: solicitud.estado === ESTADOS_SOLICITUD.PENDIENTE,
});
