import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ALCANCES_CUPON,
  ESTADOS_PEDIDO,
  TIPOS_CAMPANA,
  TIPOS_DESCUENTO_CUPON,
} from '../../common/dominio/valores.js';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { normalizarCodigo } from './aplicar-cupon.service.js';
import type { CuponPanelDto } from './dto/cupon-respuesta.dto.js';
import type { ActualizarCuponDto, CrearCuponDto } from './dto/cupon.dto.js';

export const CUPON_NO_EXISTE = 'El cupón no existe.';
const CODIGO_REPETIDO = 'Ya existe un cupón con ese código.';

export type CuponPanel = CuponPanelDto;

const SELECCION = {
  id: true,
  codigo: true,
  descripcion: true,
  tipoDescuento: true,
  valor: true,
  topeDescuento: true,
  alcance: true,
  compraMinima: true,
  fechaInicio: true,
  fechaFin: true,
  usosMaximos: true,
  usosPorCuenta: true,
  incluyeProfesionales: true,
  activo: true,
  fechaCreacion: true,
  campana: { select: { id: true, asunto: true, fechaEncolado: true } },
  articulos: {
    select: {
      articulo: {
        select: {
          id: true,
          formato: {
            select: {
              nombreFormato: true,
              producto: { select: { nombre: true } },
            },
          },
          pack: { select: { nombre: true } },
        },
      },
    },
  },
  categorias: { select: { categoria: { select: { id: true, nombre: true } } } },
  marcas: { select: { marca: { select: { id: true, nombre: true } } } },
} as const;

type FilaCupon = Prisma.CuponGetPayload<{ select: typeof SELECCION }>;

/** Lo que queda del cupón tras aplicar una edición: lo que llega, o lo guardado. */
interface CuponFinal {
  tipoDescuento: string;
  valor: number;
  topeDescuento: number | null;
  alcance: string;
  articulos: number[];
  categorias: number[];
  marcas: number[];
  fechaInicio: Date | null;
  fechaFin: Date | null;
  campanaId: number | null;
}

const fecha = (valor: string | null | undefined): Date | null | undefined =>
  valor === undefined ? undefined : valor === null ? null : new Date(valor);

/**
 * Cupones del panel (SCRUM-150). Solo con `campanas.gestionar`: van ligados al marketing. No se
 * borran (un pedido puede tenerlos): se desactivan. Editar uno ya usado no cambia lo descontado en
 * sus pedidos, que guardan su monto.
 */
@Injectable()
export class CuponesService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(): Promise<CuponPanel[]> {
    const filas = await this.prisma.cupon.findMany({
      select: SELECCION,
      orderBy: { id: 'desc' },
    });
    const usos = await this.usosDe(filas.map((fila) => fila.id));
    return filas.map((fila) => this.aRespuesta(fila, usos));
  }

  async obtener(id: number): Promise<CuponPanel> {
    const fila = await this.prisma.cupon.findUnique({
      where: { id },
      select: SELECCION,
    });
    if (!fila) throw new NotFoundException(CUPON_NO_EXISTE);
    return this.aRespuesta(fila, await this.usosDe([id]));
  }

  async crear(dto: CrearCuponDto, codigoAutor: string): Promise<CuponPanel> {
    const final: CuponFinal = {
      tipoDescuento: dto.tipoDescuento,
      valor: dto.valor,
      topeDescuento: dto.topeDescuento ?? null,
      alcance: dto.alcance,
      articulos: dto.articulos ?? [],
      categorias: dto.categorias ?? [],
      marcas: dto.marcas ?? [],
      fechaInicio: fecha(dto.fechaInicio) ?? null,
      fechaFin: fecha(dto.fechaFin) ?? null,
      campanaId: dto.campanaId ?? null,
    };
    await this.validar(final);
    const autor = await this.prisma.usuario.findUniqueOrThrow({
      where: { codigoPublico: codigoAutor },
      select: { id: true },
    });
    const id = await this.conCodigoLibre(async () => {
      const creado = await this.prisma.cupon.create({
        data: {
          codigo: normalizarCodigo(dto.codigo),
          descripcion: dto.descripcion ?? null,
          tipoDescuento: final.tipoDescuento,
          valor: final.valor,
          topeDescuento: final.topeDescuento,
          alcance: final.alcance,
          compraMinima: dto.compraMinima ?? null,
          fechaInicio: final.fechaInicio,
          fechaFin: final.fechaFin,
          usosMaximos: dto.usosMaximos ?? null,
          usosPorCuenta: dto.usosPorCuenta ?? null,
          incluyeProfesionales: dto.incluyeProfesionales ?? false,
          activo: dto.activo ?? true,
          campanaId: final.campanaId,
          usuarioId: autor.id,
          ...this.elegidos(final),
        },
        select: { id: true },
      });
      return creado.id;
    });
    return this.obtener(id);
  }

  async actualizar(id: number, dto: ActualizarCuponDto): Promise<CuponPanel> {
    const actual = await this.prisma.cupon.findUnique({
      where: { id },
      select: {
        tipoDescuento: true,
        valor: true,
        topeDescuento: true,
        alcance: true,
        fechaInicio: true,
        fechaFin: true,
        campanaId: true,
        articulos: { select: { articuloId: true } },
        categorias: { select: { categoriaId: true } },
        marcas: { select: { marcaId: true } },
      },
    });
    if (!actual) throw new NotFoundException(CUPON_NO_EXISTE);
    const final: CuponFinal = {
      tipoDescuento: dto.tipoDescuento ?? actual.tipoDescuento,
      valor: dto.valor ?? actual.valor,
      topeDescuento:
        dto.topeDescuento === undefined
          ? actual.topeDescuento
          : dto.topeDescuento,
      alcance: dto.alcance ?? actual.alcance,
      articulos: dto.articulos ?? actual.articulos.map((a) => a.articuloId),
      categorias: dto.categorias ?? actual.categorias.map((c) => c.categoriaId),
      marcas: dto.marcas ?? actual.marcas.map((m) => m.marcaId),
      fechaInicio:
        fecha(dto.fechaInicio) ??
        (dto.fechaInicio === null ? null : actual.fechaInicio),
      fechaFin:
        fecha(dto.fechaFin) ?? (dto.fechaFin === null ? null : actual.fechaFin),
      campanaId: dto.campanaId === undefined ? actual.campanaId : dto.campanaId,
    };
    // Al cambiar de alcance, lo elegido para el anterior se descarta
    if (final.alcance !== ALCANCES_CUPON.ARTICULOS) final.articulos = [];
    if (final.alcance !== ALCANCES_CUPON.CATEGORIAS_MARCAS) {
      final.categorias = [];
      final.marcas = [];
    }
    if (final.tipoDescuento !== TIPOS_DESCUENTO_CUPON.PORCENTAJE) {
      final.topeDescuento = null;
    }
    await this.validar(final);

    await this.conCodigoLibre(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.cuponArticulo.deleteMany({ where: { cuponId: id } });
        await tx.cuponCategoria.deleteMany({ where: { cuponId: id } });
        await tx.cuponMarca.deleteMany({ where: { cuponId: id } });
        await tx.cupon.update({
          where: { id },
          data: {
            ...(dto.codigo !== undefined && {
              codigo: normalizarCodigo(dto.codigo),
            }),
            ...(dto.descripcion !== undefined && {
              descripcion: dto.descripcion,
            }),
            tipoDescuento: final.tipoDescuento,
            valor: final.valor,
            topeDescuento: final.topeDescuento,
            alcance: final.alcance,
            ...(dto.compraMinima !== undefined && {
              compraMinima: dto.compraMinima,
            }),
            fechaInicio: final.fechaInicio,
            fechaFin: final.fechaFin,
            ...(dto.usosMaximos !== undefined && {
              usosMaximos: dto.usosMaximos,
            }),
            ...(dto.usosPorCuenta !== undefined && {
              usosPorCuenta: dto.usosPorCuenta,
            }),
            ...(dto.incluyeProfesionales !== undefined && {
              incluyeProfesionales: dto.incluyeProfesionales,
            }),
            ...(dto.activo !== undefined && { activo: dto.activo }),
            campanaId: final.campanaId,
            ...this.elegidos(final),
          },
        });
        return id;
      }),
    );
    return this.obtener(id);
  }

  /** Reglas que miran varios campos o la base; cada error va junto a su campo. */
  private async validar(cupon: CuponFinal): Promise<void> {
    const porcentaje = cupon.tipoDescuento === TIPOS_DESCUENTO_CUPON.PORCENTAJE;
    if (porcentaje && cupon.valor > 100) {
      throw errorDeCampo(
        BadRequestException,
        'El porcentaje de descuento debe ser de 1 a 100.',
        'valor',
      );
    }
    if (!porcentaje && cupon.topeDescuento !== null) {
      throw errorDeCampo(
        BadRequestException,
        'El tope solo se indica con un descuento por porcentaje.',
        'topeDescuento',
      );
    }
    if (
      cupon.fechaInicio &&
      cupon.fechaFin &&
      cupon.fechaInicio >= cupon.fechaFin
    ) {
      throw errorDeCampo(
        BadRequestException,
        'El fin de la vigencia debe ser posterior al inicio.',
        'fechaFin',
      );
    }
    await this.validarAlcance(cupon);
    if (cupon.campanaId !== null) {
      const campana = await this.prisma.campana.count({
        where: { id: cupon.campanaId, tipo: TIPOS_CAMPANA.ENVIO_UNICO },
      });
      if (campana === 0) {
        throw errorDeCampo(
          BadRequestException,
          'La campaña indicada no existe.',
          'campanaId',
        );
      }
    }
  }

  private async validarAlcance(cupon: CuponFinal): Promise<void> {
    if (cupon.alcance === ALCANCES_CUPON.PEDIDO) {
      if (
        cupon.articulos.length + cupon.categorias.length + cupon.marcas.length >
        0
      ) {
        throw errorDeCampo(
          BadRequestException,
          'Un cupón para todo el pedido no elige artículos, categorías ni marcas.',
          'alcance',
        );
      }
      return;
    }
    if (cupon.alcance === ALCANCES_CUPON.ARTICULOS) {
      if (cupon.categorias.length + cupon.marcas.length > 0) {
        throw errorDeCampo(
          BadRequestException,
          'Un cupón por artículos no elige categorías ni marcas.',
          'alcance',
        );
      }
      if (cupon.articulos.length === 0) {
        throw errorDeCampo(
          BadRequestException,
          'Elige al menos un formato o pack.',
          'articulos',
        );
      }
      const existen = await this.prisma.articuloVenta.count({
        where: { id: { in: cupon.articulos } },
      });
      if (existen !== new Set(cupon.articulos).size) {
        throw errorDeCampo(
          BadRequestException,
          'Algún artículo indicado no existe.',
          'articulos',
        );
      }
      return;
    }
    if (cupon.articulos.length > 0) {
      throw errorDeCampo(
        BadRequestException,
        'Un cupón por categorías o marcas no elige artículos.',
        'alcance',
      );
    }
    if (cupon.categorias.length + cupon.marcas.length === 0) {
      throw errorDeCampo(
        BadRequestException,
        'Elige al menos una categoría o una marca.',
        'categorias',
      );
    }
    const [categorias, marcas] = await Promise.all([
      this.prisma.categoria.count({ where: { id: { in: cupon.categorias } } }),
      this.prisma.marca.count({ where: { id: { in: cupon.marcas } } }),
    ]);
    if (categorias !== new Set(cupon.categorias).size) {
      throw errorDeCampo(
        BadRequestException,
        'Alguna categoría indicada no existe.',
        'categorias',
      );
    }
    if (marcas !== new Set(cupon.marcas).size) {
      throw errorDeCampo(
        BadRequestException,
        'Alguna marca indicada no existe.',
        'marcas',
      );
    }
  }

  private elegidos(cupon: CuponFinal) {
    return {
      articulos: {
        create: [...new Set(cupon.articulos)].map((articuloId) => ({
          articuloId,
        })),
      },
      categorias: {
        create: [...new Set(cupon.categorias)].map((categoriaId) => ({
          categoriaId,
        })),
      },
      marcas: {
        create: [...new Set(cupon.marcas)].map((marcaId) => ({ marcaId })),
      },
    };
  }

  /** El código es único: dos cupones con el mismo responden 409 junto al código. */
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

  /** Usos (pedidos no cancelados) y lo descontado en ellos, por cupón. */
  private async usosDe(
    ids: number[],
  ): Promise<Map<number, { usos: number; descontado: number }>> {
    if (ids.length === 0) return new Map();
    const grupos = await this.prisma.pedido.groupBy({
      by: ['cuponId'],
      where: {
        cuponId: { in: ids },
        estadoActual: { not: ESTADOS_PEDIDO.CANCELADO },
      },
      _count: { _all: true },
      _sum: { montoDescuento: true },
    });
    return new Map(
      grupos.map((grupo) => [
        grupo.cuponId!,
        {
          usos: grupo._count._all,
          descontado: grupo._sum.montoDescuento ?? 0,
        },
      ]),
    );
  }

  private aRespuesta(
    fila: FilaCupon,
    usos: Map<number, { usos: number; descontado: number }>,
  ): CuponPanel {
    const { campana, articulos, categorias, marcas, ...datos } = fila;
    return {
      ...datos,
      tipoDescuento: datos.tipoDescuento as CuponPanel['tipoDescuento'],
      alcance: datos.alcance as CuponPanel['alcance'],
      articulos: articulos.map(({ articulo }) => ({
        id: articulo.id,
        nombre: articulo.formato
          ? `${articulo.formato.producto.nombre} ${articulo.formato.nombreFormato}`
          : (articulo.pack?.nombre ?? `Artículo ${articulo.id}`),
      })),
      categorias: categorias.map(({ categoria }) => categoria),
      marcas: marcas.map(({ marca }) => marca),
      campana: campana
        ? {
            id: campana.id,
            asunto: campana.asunto,
            enviada: campana.fechaEncolado !== null,
          }
        : null,
      usos: usos.get(fila.id)?.usos ?? 0,
      descontado: usos.get(fila.id)?.descontado ?? 0,
    };
  }
}
