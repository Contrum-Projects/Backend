import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { bloquearCuenta } from './bloquear-cuenta.js';
import type {
  ActualizarDireccionDto,
  CrearDireccionDto,
} from './dto/guardar-direccion.dto.js';

const NO_EXISTE = 'La dirección no existe.';

type Tx = Prisma.TransactionClient;

/** Una dirección de la cuenta, con su comuna y región (E1-H5). */
export interface DireccionCuenta {
  id: number;
  calle: string;
  numero: string;
  referencia: string | null;
  esPrincipal: boolean;
  comuna: {
    codigoCut: string;
    nombre: string;
    region: { codigoCut: string; nombre: string };
  };
}

const SELECCION_DIRECCION = {
  id: true,
  calle: true,
  numero: true,
  referencia: true,
  esPrincipal: true,
  comuna: {
    select: {
      codigoCut: true,
      nombre: true,
      region: { select: { codigoCut: true, nombre: true } },
    },
  },
} as const;

const buscarComuna = async (tx: Tx, codigoCut: string) => {
  const comuna = await tx.comuna.findUnique({
    where: { codigoCut },
    select: { id: true },
  });
  if (!comuna) throw new BadRequestException('La comuna no existe.');
  return comuna.id;
};

@Injectable()
export class DireccionesService {
  constructor(private readonly prisma: PrismaService) {}

  /** E1-H5 · Direcciones de la cuenta, la principal primero. */
  listar(codigoPublico: string): Promise<DireccionCuenta[]> {
    return this.prisma.direccion.findMany({
      where: { usuario: { codigoPublico } },
      select: SELECCION_DIRECCION,
      orderBy: [{ esPrincipal: 'desc' }, { id: 'asc' }],
    });
  }

  /**
   * E1-H5 · Agrega una dirección; la primera de la cuenta queda como principal. Todas las
   * escrituras bloquean la cuenta para que nunca queden dos principales.
   */
  crear(
    codigoPublico: string,
    dto: CrearDireccionDto,
  ): Promise<DireccionCuenta> {
    return this.prisma.$transaction(async (tx) => {
      const usuarioId = await bloquearCuenta(tx, codigoPublico);
      const comunaId = await buscarComuna(tx, dto.comuna);

      const cantidad = await tx.direccion.count({ where: { usuarioId } });
      const esPrincipal = cantidad === 0 || dto.esPrincipal === true;
      if (esPrincipal && cantidad > 0) {
        await tx.direccion.updateMany({
          where: { usuarioId, esPrincipal: true },
          data: { esPrincipal: false },
        });
      }

      return tx.direccion.create({
        data: {
          usuarioId,
          comunaId,
          calle: dto.calle,
          numero: dto.numero,
          referencia: dto.referencia,
          esPrincipal,
        },
        select: SELECCION_DIRECCION,
      });
    });
  }

  /** E1-H5 · Edita una dirección de la cuenta; la de otra cuenta responde 404. */
  actualizar(
    codigoPublico: string,
    id: number,
    dto: ActualizarDireccionDto,
  ): Promise<DireccionCuenta> {
    return this.prisma.$transaction(async (tx) => {
      const usuarioId = await bloquearCuenta(tx, codigoPublico);
      const direccion = await tx.direccion.findFirst({
        where: { id, usuarioId },
        select: { id: true },
      });
      if (!direccion) throw new NotFoundException(NO_EXISTE);

      const comunaId =
        dto.comuna === undefined
          ? undefined
          : await buscarComuna(tx, dto.comuna);
      return tx.direccion.update({
        where: { id },
        data: {
          calle: dto.calle,
          numero: dto.numero,
          referencia: dto.referencia,
          comunaId,
        },
        select: SELECCION_DIRECCION,
      });
    });
  }

  /** E1-H5 · Deja esta dirección como la única principal de la cuenta. */
  marcarPrincipal(codigoPublico: string, id: number): Promise<DireccionCuenta> {
    return this.prisma.$transaction(async (tx) => {
      const usuarioId = await bloquearCuenta(tx, codigoPublico);
      const direccion = await tx.direccion.findFirst({
        where: { id, usuarioId },
        select: { id: true },
      });
      if (!direccion) throw new NotFoundException(NO_EXISTE);

      await tx.direccion.updateMany({
        where: { usuarioId, esPrincipal: true, NOT: { id } },
        data: { esPrincipal: false },
      });
      return tx.direccion.update({
        where: { id },
        data: { esPrincipal: true },
        select: SELECCION_DIRECCION,
      });
    });
  }

  /**
   * E1-H5 · Elimina una dirección de la cuenta. Si era la principal, la más reciente de las que
   * quedan pasa a serlo.
   */
  async eliminar(codigoPublico: string, id: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const usuarioId = await bloquearCuenta(tx, codigoPublico);
      const direccion = await tx.direccion.findFirst({
        where: { id, usuarioId },
        select: { esPrincipal: true },
      });
      if (!direccion) throw new NotFoundException(NO_EXISTE);

      await tx.direccion.delete({ where: { id } });
      if (!direccion.esPrincipal) return;

      const siguiente = await tx.direccion.findFirst({
        where: { usuarioId },
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      if (siguiente) {
        await tx.direccion.update({
          where: { id: siguiente.id },
          data: { esPrincipal: true },
        });
      }
    });
  }
}
