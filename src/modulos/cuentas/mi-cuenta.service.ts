import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ROLES } from '../../common/dominio/roles.js';
import { ESTADOS_SOLICITUD } from '../../common/dominio/valores.js';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { bloquearCuenta } from '../../prisma/bloqueos.js';
import type { ActualizarDatosDto } from './dto/actualizar-datos.dto.js';

const RUT_EN_USO = 'Ese RUT ya está en uso en otra cuenta.';

/** Solicitudes de verificación que aún no se resuelven (E10). */
const SOLICITUD_EN_CURSO: string[] = [
  ESTADOS_SOLICITUD.PENDIENTE,
  ESTADOS_SOLICITUD.REVISION_MANUAL,
];

/** Los datos personales que la cuenta ve y edita (E1-H5). */
export interface DatosPersonales {
  codigoPublico: string;
  nombre: string;
  apellido: string;
  email: string;
  rut: string | null;
  telefono: string | null;
  /** AAAA-MM-DD. */
  fechaNacimiento: string | null;
  genero: string | null;
  /** Si recibe ofertas por correo y la última vez que las aceptó (E12-H2). */
  consentimientoMarketing: {
    acepta: boolean;
    fechaConsentimiento: string | null;
  };
}

const SELECCION_DATOS = {
  codigoPublico: true,
  nombre: true,
  apellido: true,
  email: true,
  rut: true,
  telefono: true,
  fechaNacimiento: true,
  genero: true,
  aceptaMarketingEmail: true,
  fechaConsentimientoMarketing: true,
} as const;

const aDatosPersonales = ({
  fechaNacimiento,
  aceptaMarketingEmail,
  fechaConsentimientoMarketing,
  ...datos
}: Prisma.UsuarioGetPayload<{
  select: typeof SELECCION_DATOS;
}>): DatosPersonales => ({
  ...datos,
  fechaNacimiento: fechaNacimiento?.toISOString().slice(0, 10) ?? null,
  consentimientoMarketing: {
    acepta: aceptaMarketingEmail,
    fechaConsentimiento: fechaConsentimientoMarketing?.toISOString() ?? null,
  },
});

/**
 * El nombre y el apellido se comparan con los del SII al verificar (SCRUM-163): no cambian si la
 * cuenta ya es profesional o tiene una solicitud en curso, como el RUT. Si no, alguien podría
 * verificarse con el nombre de otra persona y volver al suyo.
 */
const verificarCambioNombre = async (
  tx: Prisma.TransactionClient,
  usuarioId: number,
  rol: string,
) => {
  if (rol === ROLES.PROFESIONAL) {
    throw new ForbiddenException(
      'Tu nombre quedó registrado en la verificación profesional y no se puede cambiar. Si hay un error, contacta a la tienda.',
    );
  }
  const solicitudEnCurso = await tx.solicitudVerificacion.findFirst({
    where: { solicitanteId: usuarioId, estado: { in: SOLICITUD_EN_CURSO } },
    select: { id: true },
  });
  if (solicitudEnCurso) {
    throw new ForbiddenException(
      'Tienes una verificación profesional en curso. Podrás cambiar tu nombre cuando se resuelva.',
    );
  }
};

/**
 * El RUT nuevo (o `null` para borrarlo) no puede romper la verificación profesional ni estar en
 * otra cuenta.
 */
const verificarCambioRut = async (
  tx: Prisma.TransactionClient,
  usuarioId: number,
  rol: string,
  rut: string | null,
) => {
  if (rol === ROLES.PROFESIONAL) {
    throw new ForbiddenException(
      'Tu RUT quedó registrado en la verificación profesional y no se puede cambiar. Si hay un error, contacta a la tienda.',
    );
  }
  const solicitudEnCurso = await tx.solicitudVerificacion.findFirst({
    where: { solicitanteId: usuarioId, estado: { in: SOLICITUD_EN_CURSO } },
    select: { id: true },
  });
  if (solicitudEnCurso) {
    throw new ForbiddenException(
      'Tienes una verificación profesional en curso. Podrás cambiar tu RUT cuando se resuelva.',
    );
  }
  if (rut === null) return;

  const otra = await tx.usuario.findFirst({
    where: { rut, NOT: { id: usuarioId } },
    select: { id: true },
  });
  if (otra) throw new ConflictException(RUT_EN_USO);
};

export const FECHA_NACIMIENTO_FIJA =
  'La fecha de nacimiento ya está registrada y no se puede cambiar. Si hay un error, escríbenos para corregirla.';

@Injectable()
export class MiCuentaService {
  constructor(private readonly prisma: PrismaService) {}

  /** E1-H5 · Datos personales de la cuenta con la sesión iniciada. */
  async obtener(codigoPublico: string): Promise<DatosPersonales> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { codigoPublico },
      select: SELECCION_DATOS,
    });
    if (!usuario) throw new NotFoundException('La cuenta no existe.');
    return aDatosPersonales(usuario);
  }

  /**
   * E1-H5 · Guarda los datos que vienen y devuelve la cuenta actualizada. El RUT no puede estar
   * en otra cuenta, y no cambia si la verificación profesional depende de él: la cuenta ya es
   * profesional o tiene una solicitud en curso (decisión del 20 oct). Lo mismo vale para el nombre
   * y el apellido, que se comparan con los del SII (SCRUM-163). Se lee y se guarda con la
   * cuenta bloqueada, para que la verificación no se resuelva con un RUT a medio cambiar.
   */
  async actualizar(
    codigoPublico: string,
    dto: ActualizarDatosDto,
  ): Promise<DatosPersonales> {
    let fechaNacimiento: Date | null | undefined = undefined;
    if (dto.fechaNacimiento === null) fechaNacimiento = null;
    if (dto.fechaNacimiento) {
      fechaNacimiento = new Date(`${dto.fechaNacimiento}T00:00:00Z`);
      if (fechaNacimiento > new Date()) {
        throw new BadRequestException(
          'La fecha de nacimiento no puede ser futura.',
        );
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const usuarioId = await bloquearCuenta(tx, codigoPublico);
        const cuenta = await tx.usuario.findUniqueOrThrow({
          where: { id: usuarioId },
          select: {
            rol: true,
            rut: true,
            nombre: true,
            apellido: true,
            fechaNacimiento: true,
          },
        });
        // SCRUM-152 · Se indica una sola vez: con la fecha guardada no se cambia ni se borra, así
        // nadie la mueve al día de hoy para recibir la oferta de cumpleaños. La misma fecha no cambia nada
        if (
          fechaNacimiento !== undefined &&
          cuenta.fechaNacimiento !== null &&
          fechaNacimiento?.getTime() !== cuenta.fechaNacimiento.getTime()
        ) {
          throw errorDeCampo(
            ConflictException,
            FECHA_NACIMIENTO_FIJA,
            'fechaNacimiento',
          );
        }
        if (dto.rut !== undefined && dto.rut !== cuenta.rut) {
          await verificarCambioRut(tx, usuarioId, cuenta.rol, dto.rut);
        }
        const cambiaNombre =
          (dto.nombre !== undefined && dto.nombre !== cuenta.nombre) ||
          (dto.apellido !== undefined && dto.apellido !== cuenta.apellido);
        if (cambiaNombre) {
          await verificarCambioNombre(tx, usuarioId, cuenta.rol);
        }

        const usuario = await tx.usuario.update({
          where: { id: usuarioId },
          data: {
            nombre: dto.nombre,
            apellido: dto.apellido,
            telefono: dto.telefono,
            rut: dto.rut,
            fechaNacimiento,
            genero: dto.genero,
          },
          select: SELECCION_DATOS,
        });
        return aDatosPersonales(usuario);
      });
    } catch (error) {
      // Otra cuenta guardó el mismo RUT entre la verificación y este cambio
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(RUT_EN_USO);
      }
      throw error;
    }
  }
}
