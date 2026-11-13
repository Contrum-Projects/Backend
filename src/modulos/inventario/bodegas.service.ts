import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  ActualizarBodegaDto,
  ActualizarUbicacionDto,
  BodegaPanelDto,
  CrearBodegaDto,
  CrearUbicacionDto,
} from './dto/bodega.dto.js';

type Tx = Prisma.TransactionClient;

export const BODEGA_NO_EXISTE = 'La bodega no existe.';
export const UBICACION_NO_EXISTE = 'La ubicación no existe.';
export const BODEGA_CON_STOCK =
  'La bodega todavía tiene stock: transfiérelo o ajústalo a cero antes de desactivarla.';
export const UBICACION_CON_STOCK =
  'La ubicación todavía tiene stock: transfiérelo o ajústalo a cero antes de desactivarla.';
const CODIGO_REPETIDO = 'Esa bodega ya tiene una ubicación con ese código.';

export type BodegaPanel = BodegaPanelDto;

const SELECCION = {
  id: true,
  nombre: true,
  direccion: true,
  tipo: true,
  abasteceVentaOnline: true,
  activa: true,
  comuna: {
    select: {
      codigoCut: true,
      nombre: true,
      region: { select: { codigoCut: true, nombre: true } },
    },
  },
  ubicaciones: {
    select: {
      id: true,
      codigo: true,
      zona: true,
      pasillo: true,
      estante: true,
      nivel: true,
      activa: true,
    },
    orderBy: [{ codigo: 'asc' }, { id: 'asc' }],
  },
} as const satisfies Prisma.BodegaSelect;

type FilaBodega = Prisma.BodegaGetPayload<{ select: typeof SELECCION }>;

/** El código como lo guarda la bodega: sin espacios a los lados y en mayúsculas. */
const normalizarCodigo = (codigo: string) => codigo.trim().toUpperCase();

/**
 * Bodegas y ubicaciones del panel (SCRUM-151, decisiones del 8 nov). Solo el administrador
 * (`bodegas.gestionar`). No se borran: se desactivan, y solo sin stock, así nunca queda stock que
 * no se ve ni se puede mover. Una ubicación o bodega desactivada no recibe stock nuevo (las
 * entradas, ajustes y transferencias ya lo exigen) y su stock no cuenta para la venta online.
 */
@Injectable()
export class BodegasService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(): Promise<BodegaPanel[]> {
    const filas = await this.prisma.bodega.findMany({
      select: SELECCION,
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    });
    return this.conStock(filas);
  }

  async crear(dto: CrearBodegaDto): Promise<BodegaPanel> {
    const comunaId = await this.comunaId(dto.comuna);
    const { id } = await this.prisma.bodega.create({
      data: {
        nombre: dto.nombre,
        direccion: dto.direccion,
        tipo: dto.tipo,
        abasteceVentaOnline: dto.abasteceVentaOnline ?? true,
        comunaId,
      },
      select: { id: true },
    });
    return this.obtener(id);
  }

  async actualizar(id: number, dto: ActualizarBodegaDto): Promise<BodegaPanel> {
    const comunaId =
      dto.comuna === undefined ? undefined : await this.comunaId(dto.comuna);
    await this.prisma.$transaction(async (tx) => {
      const existe = await tx.bodega.count({ where: { id } });
      if (!existe) throw new NotFoundException(BODEGA_NO_EXISTE);
      await tx.bodega.update({
        where: { id },
        data: {
          nombre: dto.nombre,
          direccion: dto.direccion,
          tipo: dto.tipo,
          abasteceVentaOnline: dto.abasteceVentaOnline,
          activa: dto.activa,
          comunaId,
        },
      });
      // Después de desactivarla: una entrada que llegue ahora ya no la acepta
      if (
        dto.activa === false &&
        (await this.stockDe(tx, { bodegaId: id })) > 0
      ) {
        throw errorDeCampo(ConflictException, BODEGA_CON_STOCK, 'activa');
      }
    });
    return this.obtener(id);
  }

  async crearUbicacion(
    bodegaId: number,
    dto: CrearUbicacionDto,
  ): Promise<BodegaPanel> {
    const existe = await this.prisma.bodega.count({ where: { id: bodegaId } });
    if (!existe) throw new NotFoundException(BODEGA_NO_EXISTE);
    await this.conCodigoLibre(() =>
      this.prisma.ubicacion.create({
        data: {
          bodegaId,
          codigo: normalizarCodigo(dto.codigo),
          zona: dto.zona ?? null,
          pasillo: dto.pasillo ?? null,
          estante: dto.estante ?? null,
          nivel: dto.nivel ?? null,
        },
      }),
    );
    return this.obtener(bodegaId);
  }

  async actualizarUbicacion(
    bodegaId: number,
    ubicacionId: number,
    dto: ActualizarUbicacionDto,
  ): Promise<BodegaPanel> {
    await this.conCodigoLibre(() =>
      this.prisma.$transaction(async (tx) => {
        const existe = await tx.ubicacion.count({
          where: { id: ubicacionId, bodegaId },
        });
        if (!existe) throw new NotFoundException(UBICACION_NO_EXISTE);
        await tx.ubicacion.update({
          where: { id: ubicacionId },
          data: {
            codigo:
              dto.codigo === undefined
                ? undefined
                : normalizarCodigo(dto.codigo),
            zona: dto.zona,
            pasillo: dto.pasillo,
            estante: dto.estante,
            nivel: dto.nivel,
            activa: dto.activa,
          },
        });
        if (
          dto.activa === false &&
          (await this.stockDe(tx, { ubicacionId })) > 0
        ) {
          throw errorDeCampo(ConflictException, UBICACION_CON_STOCK, 'activa');
        }
      }),
    );
    return this.obtener(bodegaId);
  }

  private async obtener(id: number): Promise<BodegaPanel> {
    const fila = await this.prisma.bodega.findUnique({
      where: { id },
      select: SELECCION,
    });
    if (!fila) throw new NotFoundException(BODEGA_NO_EXISTE);
    const [bodega] = await this.conStock([fila]);
    return bodega!;
  }

  private async comunaId(codigoCut: string): Promise<number> {
    const comuna = await this.prisma.comuna.findUnique({
      where: { codigoCut },
      select: { id: true },
    });
    if (!comuna) {
      throw errorDeCampo(BadRequestException, 'La comuna no existe.', 'comuna');
    }
    return comuna.id;
  }

  private async stockDe(
    tx: Tx,
    donde: { bodegaId: number } | { ubicacionId: number },
  ): Promise<number> {
    const { _sum } = await tx.existencia.aggregate({
      where:
        'bodegaId' in donde
          ? { ubicacion: { bodegaId: donde.bodegaId } }
          : { ubicacionId: donde.ubicacionId },
      _sum: { cantidad: true },
    });
    return _sum.cantidad ?? 0;
  }

  /** El código es único en su bodega: repetido responde 409 junto al código. */
  private async conCodigoLibre<T>(guardar: () => Promise<T>): Promise<T> {
    try {
      return await guardar();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw errorDeCampo(ConflictException, CODIGO_REPETIDO, 'codigo');
      }
      throw error;
    }
  }

  /** Cada bodega y ubicación con las unidades que guarda (de todos los formatos). */
  private async conStock(filas: FilaBodega[]): Promise<BodegaPanel[]> {
    const ids = filas.flatMap((fila) => fila.ubicaciones.map((u) => u.id));
    const grupos =
      ids.length === 0
        ? []
        : await this.prisma.existencia.groupBy({
            by: ['ubicacionId'],
            where: { ubicacionId: { in: ids } },
            _sum: { cantidad: true },
          });
    const stock = new Map(
      grupos.map((g) => [g.ubicacionId, g._sum.cantidad ?? 0]),
    );
    return filas.map(({ comuna, ubicaciones, ...bodega }) => {
      const conStock = ubicaciones.map((u) => ({
        ...u,
        stock: stock.get(u.id) ?? 0,
      }));
      return {
        ...bodega,
        tipo: bodega.tipo as BodegaPanel['tipo'],
        comuna: { codigoCut: comuna.codigoCut, nombre: comuna.nombre },
        region: comuna.region,
        stock: conStock.reduce((suma, u) => suma + u.stock, 0),
        ubicaciones: conStock,
      };
    });
  }
}
