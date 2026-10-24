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

/** Lo que el panel necesita ver de un producto: sus datos y el nombre de su marca y categoría. */
const INCLUIR = {
  marca: { select: { id: true, nombre: true } },
  categoria: { select: { id: true, nombre: true } },
} satisfies Prisma.ProductoInclude;

@Injectable()
export class ProductosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea un producto (E3-H1, RF-03.01). Exige que la categoría exista y que la marca exista
   * y esté activa. Nace activo y con la descripción escrita a mano.
   */
  async crear(dto: CrearProductoDto) {
    await this.exigirCategoria(dto.categoriaId);
    await this.exigirMarcaActiva(dto.marcaId);
    return this.prisma.producto.create({
      data: {
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        categoriaId: dto.categoriaId,
        marcaId: dto.marcaId,
        canalVenta: dto.canalVenta,
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
      },
      include: INCLUIR,
    });
  }

  /**
   * Cambia los datos de un producto (E3-H1). Solo se modifica lo que llega en el cuerpo.
   * Si la descripción venía sugerida por IA y el personal la cambia, el origen pasa a
   * «IA editada» (RF-04.04).
   */
  async actualizar(id: number, dto: ActualizarProductoDto) {
    if (
      dto.nombre === undefined &&
      dto.descripcion === undefined &&
      dto.categoriaId === undefined &&
      dto.marcaId === undefined &&
      dto.canalVenta === undefined
    ) {
      throw new BadRequestException('Indica al menos un campo para cambiar.');
    }
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
        categoriaId: dto.categoriaId,
        marcaId: dto.marcaId,
        canalVenta: dto.canalVenta,
        origenDescripcion: descripcionEditada
          ? ORIGENES_DESCRIPCION.IA_EDITADA
          : undefined,
      },
      include: INCLUIR,
    });
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
      throw new NotFoundException('La categoría no existe.');
    }
  }

  private async exigirMarcaActiva(marcaId: number) {
    const marca = await this.prisma.marca.findUnique({
      where: { id: marcaId },
      select: { activa: true },
    });
    if (!marca) {
      throw new NotFoundException('La marca no existe.');
    }
    if (!marca.activa) {
      throw new BadRequestException('La marca está desactivada.');
    }
  }
}
