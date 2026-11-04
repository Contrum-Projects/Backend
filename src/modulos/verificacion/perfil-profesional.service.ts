import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ROLES } from '../../common/dominio/roles.js';
import { SOLO_PROFESIONAL } from '../../autenticacion/profesional.guard.js';
import { bloquearCuenta } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { GuardarPerfilProfesionalDto } from './dto/guardar-perfil-profesional.dto.js';

export const SIN_PERFIL = 'Aún no completas tu perfil profesional.';

/** Perfil profesional de la cuenta, como lo devuelve la API (E10-H5). */
export interface PerfilProfesionalCuenta {
  anosExperiencia: number;
  modalidad: string;
  especialidades: string[];
  nombreLugarTrabajo: string | null;
  redSocial: string | null;
  fechaActualizacion: Date;
}

const SELECCION = {
  anosExperiencia: true,
  modalidad: true,
  especialidades: true,
  nombreLugarTrabajo: true,
  redSocial: true,
  fechaActualizacion: true,
} as const;

@Injectable()
export class PerfilProfesionalService {
  constructor(private readonly prisma: PrismaService) {}

  /** E10-H5 · Perfil de la cuenta; 404 si aún no lo completa. */
  async obtener(codigoPublico: string): Promise<PerfilProfesionalCuenta> {
    const perfil = await this.prisma.perfilProfesional.findFirst({
      where: { usuario: { codigoPublico } },
      select: SELECCION,
    });
    if (!perfil) throw new NotFoundException(SIN_PERFIL);
    return perfil;
  }

  /**
   * E10-H5 · Crea el perfil o lo reemplaza entero. La fila de la cuenta se bloquea: dos guardados a
   * la vez no chocan en el perfil único por cuenta, y el rol se lee de la base con el bloqueo
   * tomado, además del guard, por si dejó de ser profesional después de emitido el token.
   */
  guardar(
    codigoPublico: string,
    dto: GuardarPerfilProfesionalDto,
  ): Promise<PerfilProfesionalCuenta> {
    return this.prisma.$transaction(async (tx) => {
      const usuarioId = await bloquearCuenta(tx, codigoPublico);
      const profesional = await tx.usuario.findFirst({
        where: { id: usuarioId, rol: ROLES.PROFESIONAL, activo: true },
        select: { id: true },
      });
      if (!profesional) throw new ForbiddenException(SOLO_PROFESIONAL);

      const datos = {
        anosExperiencia: dto.anosExperiencia,
        modalidad: dto.modalidad,
        especialidades: dto.especialidades,
        nombreLugarTrabajo: dto.nombreLugarTrabajo ?? null,
        redSocial: dto.redSocial ?? null,
      };
      return tx.perfilProfesional.upsert({
        where: { usuarioId },
        create: { usuarioId, ...datos },
        update: datos,
        select: SELECCION,
      });
    });
  }
}
