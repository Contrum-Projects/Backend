import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ORIGENES_DESCRIPCION } from '../../common/dominio/valores.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { escaparComodines } from '../../common/validacion/texto-busqueda.js';
import { POR_PAGINA } from '../../common/validacion/paginacion.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ActualizarProductoDto } from './dto/actualizar-producto.dto.js';
import type { CrearProductoDto } from './dto/crear-producto.dto.js';
import type { ListarProductosDto } from './dto/listar-productos.dto.js';
import type { SugerenciaUsadaDto } from './dto/sugerencia-usada.dto.js';
import { FirmaSugerencia } from './firma-sugerencia.js';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';

/** Lo que el panel necesita ver de un producto: sus datos y el nombre de su marca y categoría. */
const INCLUIR = {
  marca: { select: { id: true, nombre: true } },
  categoria: { select: { id: true, nombre: true } },
} satisfies Prisma.ProductoInclude;

export const MENSAJE_SUGERENCIA_INVALIDA =
  'La sugerencia de descripción no es válida. Pide una nueva o escribe la descripción a mano.';

type OrigenDescripcion =
  (typeof ORIGENES_DESCRIPCION)[keyof typeof ORIGENES_DESCRIPCION];

@Injectable()
export class ProductosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firma: FirmaSugerencia,
  ) {}

  /**
   * Crea un producto (E3-H1, RF-03.01). Exige que la categoría exista y que la marca exista
   * y esté activa. Nace activo. La descripción es manual salvo que llegue la sugerencia firmada
   * de la IA de la que partió (E4-H2, RF-04.03 y RF-04.04).
   */
  async crear(dto: CrearProductoDto) {
    const origenDescripcion = dto.sugerencia
      ? this.origenSegunSugerencia(dto.descripcion, dto.sugerencia)
      : ORIGENES_DESCRIPCION.MANUAL;
    await this.exigirCategoria(dto.categoriaId);
    await this.exigirMarcaActiva(dto.marcaId);
    return this.prisma.producto.create({
      data: {
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        ingredientes: dto.ingredientes,
        categoriaId: dto.categoriaId,
        marcaId: dto.marcaId,
        canalVenta: dto.canalVenta,
        origenDescripcion,
      },
      include: INCLUIR,
    });
  }

  /**
   * Cambia los datos de un producto (E3-H1). Solo se modifica lo que llega en el cuerpo.
   * Con la sugerencia firmada, el origen se decide como al crear (E4-H2). Sin ella, si la
   * descripción venía de la IA y el personal la cambia, el origen pasa a «IA editada» (RF-04.04).
   */
  async actualizar(id: number, dto: ActualizarProductoDto) {
    if (
      dto.nombre === undefined &&
      dto.descripcion === undefined &&
      dto.ingredientes === undefined &&
      dto.categoriaId === undefined &&
      dto.marcaId === undefined &&
      dto.canalVenta === undefined
    ) {
      throw new BadRequestException('Indica al menos un campo para cambiar.');
    }
    if (dto.sugerencia && dto.descripcion === undefined) {
      throw new BadRequestException(
        'Envía la descripción junto con la sugerencia de la que partió.',
      );
    }
    const origenSugerido =
      dto.sugerencia && dto.descripcion !== undefined
        ? this.origenSegunSugerencia(dto.descripcion, dto.sugerencia)
        : undefined;
    const actual = await this.prisma.producto.findUnique({
      where: { id },
      select: { descripcion: true, origenDescripcion: true },
    });
    if (!actual) {
      throw new NotFoundException('El producto no existe.');
    }
    if (dto.categoriaId !== undefined) {
      await this.exigirCategoria(dto.categoriaId);
    }
    if (dto.marcaId !== undefined) {
      await this.exigirMarcaActiva(dto.marcaId);
    }
    const descripcionEditada =
      dto.descripcion !== undefined &&
      dto.descripcion !== actual.descripcion &&
      actual.origenDescripcion === ORIGENES_DESCRIPCION.IA;
    return this.prisma.producto.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        ingredientes: dto.ingredientes,
        categoriaId: dto.categoriaId,
        marcaId: dto.marcaId,
        canalVenta: dto.canalVenta,
        origenDescripcion:
          origenSugerido ??
          (descripcionEditada ? ORIGENES_DESCRIPCION.IA_EDITADA : undefined),
      },
      include: INCLUIR,
    });
  }

  /**
   * Origen de una descripción que partió de una sugerencia de la IA (E4-H2): «IA» si se aceptó
   * sin cambios, «IA editada» si se corrigió. Una firma que no corresponde al texto sugerido se
   * rechaza con 400, así la IA nunca queda como origen sin que la sugerencia sea real.
   */
  private origenSegunSugerencia(
    descripcion: string,
    sugerencia: SugerenciaUsadaDto,
  ): OrigenDescripcion {
    if (!this.firma.verificar(sugerencia.descripcion, sugerencia.firma)) {
      throw new BadRequestException(MENSAJE_SUGERENCIA_INVALIDA);
    }
    return descripcion === sugerencia.descripcion
      ? ORIGENES_DESCRIPCION.IA
      : ORIGENES_DESCRIPCION.IA_EDITADA;
  }

  /**
   * Desactiva un producto (E3-H1): deja de mostrarse en la tienda pero no se borra, así
   * los pedidos y el historial que lo mencionan siguen intactos. Repetir la acción sobre
   * un producto ya desactivado no cambia nada.
   */
  async desactivar(id: number) {
    const producto = await this.prisma.producto.findUnique({
      where: { id },
      select: { activo: true },
    });
    if (!producto) {
      throw new NotFoundException('El producto no existe.');
    }
    if (!producto.activo) {
      return this.obtener(id);
    }
    return this.prisma.producto.update({
      where: { id },
      data: { activo: false },
      include: INCLUIR,
    });
  }

  async obtener(id: number) {
    const producto = await this.prisma.producto.findUnique({
      where: { id },
      include: INCLUIR,
    });
    if (!producto) {
      throw new NotFoundException('El producto no existe.');
    }
    return producto;
  }

  /** Productos del panel, ordenados por nombre. Por defecto solo los activos. */
  async listar(filtros: ListarProductosDto) {
    const pagina = filtros.pagina ?? 1;
    const limite = filtros.limite ?? POR_PAGINA;
    const where: Prisma.ProductoWhereInput = {
      activo: filtros.incluirInactivos ? undefined : true,
      categoriaId: filtros.categoriaId,
      marcaId: filtros.marcaId,
      nombre: filtros.buscar
        ? { contains: escaparComodines(filtros.buscar), mode: 'insensitive' }
        : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.producto.findMany({
        where,
        include: INCLUIR,
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
        skip: (pagina - 1) * limite,
        take: limite,
      }),
      this.prisma.producto.count({ where }),
    ]);
    return { items, total, pagina, limite };
  }

  private async exigirCategoria(categoriaId: number) {
    const categoria = await this.prisma.categoria.findUnique({
      where: { id: categoriaId },
      select: { id: true },
    });
    if (!categoria) {
      throw errorDeCampo(
        NotFoundException,
        'La categoría no existe.',
        'categoriaId',
      );
    }
  }

  private async exigirMarcaActiva(marcaId: number) {
    const marca = await this.prisma.marca.findUnique({
      where: { id: marcaId },
      select: { activa: true },
    });
    if (!marca) {
      throw errorDeCampo(NotFoundException, 'La marca no existe.', 'marcaId');
    }
    if (!marca.activa) {
      throw errorDeCampo(
        BadRequestException,
        'La marca está desactivada.',
        'marcaId',
      );
    }
  }
}
