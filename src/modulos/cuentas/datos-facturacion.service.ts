import { Injectable, NotFoundException } from '@nestjs/common';
import { bloquearCuenta } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { buscarComuna } from './comunas.js';
import type {
  ActualizarDatosFacturacionDto,
  CrearDatosFacturacionDto,
} from './dto/guardar-datos-facturacion.dto.js';

const NO_EXISTE = 'Los datos de facturación no existen.';

/** Un registro de facturación de la cuenta, con su comuna y región (E9-H2). */
export interface DatosFacturacionCuenta {
  id: number;
  rut: string;
  razonSocial: string;
  giro: string;
  direccion: string;
  correoFacturacion: string | null;
  comuna: {
    codigoCut: string;
    nombre: string;
    region: { codigoCut: string; nombre: string };
  };
}

const SELECCION = {
  id: true,
  rut: true,
  razonSocial: true,
  giro: true,
  direccion: true,
  correoFacturacion: true,
  comuna: {
    select: {
      codigoCut: true,
      nombre: true,
      region: { select: { codigoCut: true, nombre: true } },
    },
  },
} as const;

@Injectable()
export class DatosFacturacionService {
  constructor(private readonly prisma: PrismaService) {}

  /** E9-H2 · Registros activos de la cuenta, del más antiguo al más reciente. */
  listar(codigoPublico: string): Promise<DatosFacturacionCuenta[]> {
    return this.prisma.datosFacturacion.findMany({
      where: { usuario: { codigoPublico }, activo: true },
      select: SELECCION,
      orderBy: { id: 'asc' },
    });
  }

  /** E9-H2 · Agrega un registro de facturación a la cuenta. */
  crear(
    codigoPublico: string,
    dto: CrearDatosFacturacionDto,
  ): Promise<DatosFacturacionCuenta> {
    return this.prisma.$transaction(async (tx) => {
      const usuarioId = await bloquearCuenta(tx, codigoPublico);
      const comunaId = await buscarComuna(tx, dto.comuna);
      return tx.datosFacturacion.create({
        data: {
          usuarioId,
          comunaId,
          rut: dto.rut,
          razonSocial: dto.razonSocial,
          giro: dto.giro,
          direccion: dto.direccion,
          correoFacturacion: dto.correoFacturacion,
        },
        select: SELECCION,
      });
    });
  }

  /**
   * E9-H2 · Edita un registro de la cuenta. El de otra cuenta, o uno ya desactivado, responde 404.
   * Los pedidos ya creados no cambian: el documento guarda su propia copia de los datos (E9).
   */
  actualizar(
    codigoPublico: string,
    id: number,
    dto: ActualizarDatosFacturacionDto,
  ): Promise<DatosFacturacionCuenta> {
    return this.prisma.$transaction(async (tx) => {
      const usuarioId = await bloquearCuenta(tx, codigoPublico);
      await this.exigirActivo(tx, usuarioId, id);
      const comunaId =
        dto.comuna === undefined
          ? undefined
          : await buscarComuna(tx, dto.comuna);
      return tx.datosFacturacion.update({
        where: { id },
        data: {
          rut: dto.rut,
          razonSocial: dto.razonSocial,
          giro: dto.giro,
          direccion: dto.direccion,
          correoFacturacion: dto.correoFacturacion,
          comunaId,
        },
        select: SELECCION,
      });
    });
  }

  /**
   * E9-H2 · Quita un registro de la lista de la cuenta. Se desactiva en vez de borrarse: los
   * pedidos que lo usaron siguen apuntando a él.
   */
  async desactivar(codigoPublico: string, id: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const usuarioId = await bloquearCuenta(tx, codigoPublico);
      await this.exigirActivo(tx, usuarioId, id);
      await tx.datosFacturacion.update({
        where: { id },
        data: { activo: false },
      });
    });
  }

  private async exigirActivo(
    tx: Pick<PrismaService, 'datosFacturacion'>,
    usuarioId: number,
    id: number,
  ) {
    const registro = await tx.datosFacturacion.findFirst({
      where: { id, usuarioId, activo: true },
      select: { id: true },
    });
    if (!registro) throw new NotFoundException(NO_EXISTE);
  }
}
