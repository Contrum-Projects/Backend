import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { urlPublicaArchivo } from '../../almacen/almacen-archivos.js';
import { precioConIva } from '../../common/dominio/montos.js';
import { CANALES_VENTA } from '../../common/dominio/valores.js';
import { POR_PAGINA } from '../../common/validacion/paginacion.js';
import { escaparComodines } from '../../common/validacion/texto-busqueda.js';
import type { Entorno } from '../../config/entorno.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ListarProductosDto } from './dto/listar-productos.dto.js';

/** Lo que el panel necesita ver de un producto: sus datos y el nombre de su marca y categoría. */
const INCLUIR = {
  marca: { select: { id: true, nombre: true } },
  categoria: { select: { id: true, nombre: true } },
} satisfies Prisma.ProductoInclude;

const ORDEN = [
  { nombre: 'asc' },
  { id: 'asc' },
] satisfies Prisma.ProductoOrderByWithRelationInput[];

type FilaProducto = Prisma.ProductoGetPayload<{ include: typeof INCLUIR }>;

/** Una fila del listado del panel (E3-H1, SCRUM-150). */
export type ProductoListadoPanel = FilaProducto & {
  imagen: string | null;
  formatos: number;
  precioDesde: number | null;
  stockTotal: number;
  stockBajo: boolean;
};

export interface ConteosProductosPanel {
  todos: number;
  exclusivos: number;
  stockBajo: number;
  inactivos: number;
}

export interface ListadoProductosPanel {
  items: ProductoListadoPanel[];
  total: number;
  pagina: number;
  limite: number;
  conteos: ConteosProductosPanel;
}

/**
 * Listado de productos del panel (E3-H1, Figma P3a, SCRUM-150). Solo lectura desde PostgreSQL:
 * el stock y los precios no se guardan en caché.
 */
@Injectable()
export class ListadoProductosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
  ) {}

  /**
   * Productos por nombre, con la búsqueda (nombre, marca o SKU), la categoría y la marca. Por
   * defecto solo los activos; `incluirInactivos` también los desactivados y `soloInactivos` solo
   * ellos. `canalVenta` y `stockBajo` acotan más. `conteos` cuenta cada filtro de los chips con la
   * búsqueda, la categoría y la marca aplicadas («Todos» incluye los inactivos).
   */
  async listar(filtros: ListarProductosDto): Promise<ListadoProductosPanel> {
    const pagina = filtros.pagina ?? 1;
    const limite = filtros.limite ?? POR_PAGINA;
    const busqueda = this.busqueda(filtros);
    const bajos = await this.productosBajoMinimo();
    const conStockBajo: Prisma.ProductoWhereInput = { id: { in: bajos } };

    const where: Prisma.ProductoWhereInput = {
      AND: [
        busqueda,
        filtros.soloInactivos
          ? { activo: false }
          : filtros.incluirInactivos
            ? {}
            : { activo: true },
        filtros.canalVenta ? { canalVenta: filtros.canalVenta } : {},
        filtros.stockBajo ? conStockBajo : {},
      ],
    };
    const [filas, total, todos, exclusivos, stockBajo, inactivos] =
      await this.prisma.$transaction([
        this.prisma.producto.findMany({
          where,
          include: INCLUIR,
          orderBy: ORDEN,
          skip: (pagina - 1) * limite,
          take: limite,
        }),
        this.prisma.producto.count({ where }),
        this.prisma.producto.count({ where: busqueda }),
        this.prisma.producto.count({
          where: {
            AND: [busqueda, { canalVenta: CANALES_VENTA.PROFESIONAL }],
          },
        }),
        this.prisma.producto.count({
          where: { AND: [busqueda, conStockBajo] },
        }),
        this.prisma.producto.count({
          where: { AND: [busqueda, { activo: false }] },
        }),
      ]);

    return {
      items: await this.completar(filas, new Set(bajos)),
      total,
      pagina,
      limite,
      conteos: { todos, exclusivos, stockBajo, inactivos },
    };
  }

  /** Búsqueda en el nombre, la marca o el SKU de un formato, y la categoría y la marca. */
  private busqueda({
    buscar,
    categoriaId,
    marcaId,
  }: ListarProductosDto): Prisma.ProductoWhereInput {
    const texto = buscar
      ? { contains: escaparComodines(buscar), mode: 'insensitive' as const }
      : undefined;
    return {
      categoriaId,
      marcaId,
      OR: texto
        ? [
            { nombre: texto },
            { marca: { is: { nombre: texto } } },
            { formatos: { some: { articulo: { sku: texto } } } },
          ]
        : undefined,
    };
  }

  /**
   * Productos con algún formato bajo su mínimo, con la regla del aviso (E11-H6): el stock total
   * del formato en todas sus ubicaciones bajo un mínimo mayor que 0.
   */
  private async productosBajoMinimo(): Promise<number[]> {
    const filas = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT DISTINCT f.id_producto AS id
      FROM formato_producto f
      LEFT JOIN existencia e ON e.id_formato = f.id_formato
      WHERE f.stock_minimo > 0
      GROUP BY f.id_formato, f.id_producto, f.stock_minimo
      HAVING COALESCE(SUM(e.cantidad), 0) < f.stock_minimo`;
    return filas.map((fila) => fila.id);
  }

  /**
   * Los datos de cada fila que salen de sus formatos: la foto principal del predeterminado, los
   * formatos activos, el menor precio con IVA del canal del producto (minorista si es general,
   * mayorista si es exclusivo) entre los activos, y las unidades en ubicaciones activas de bodegas
   * activas.
   */
  private async completar(
    filas: FilaProducto[],
    bajos: Set<number>,
  ): Promise<ProductoListadoPanel[]> {
    if (filas.length === 0) {
      return [];
    }
    const formatos = await this.prisma.formatoProducto.findMany({
      where: { productoId: { in: filas.map((fila) => fila.id) } },
      select: {
        id: true,
        productoId: true,
        esPredeterminado: true,
        articulo: {
          select: {
            activo: true,
            precioMinoristaNeto: true,
            precioMayoristaNeto: true,
            imagenes: {
              select: { ubicacionArchivo: true },
              orderBy: [
                { esPrincipal: 'desc' },
                { orden: 'asc' },
                { id: 'asc' },
              ],
              take: 1,
            },
          },
        },
      },
    });
    const stock = await this.prisma.existencia.groupBy({
      by: ['formatoId'],
      where: {
        formatoId: { in: formatos.map((formato) => formato.id) },
        ubicacion: { activa: true, bodega: { activa: true } },
      },
      _sum: { cantidad: true },
    });
    const unidades = new Map(
      stock.map((fila) => [fila.formatoId, fila._sum.cantidad ?? 0]),
    );
    const porcentajeIva = this.config.get('IVA_PORCENTAJE', { infer: true });
    const urlBase = this.config.get('R2_URL_PUBLICA', { infer: true });

    return filas.map((fila) => {
      const propios = formatos.filter(
        (formato) => formato.productoId === fila.id,
      );
      const activos = propios.filter((formato) => formato.articulo.activo);
      const exclusivo = fila.canalVenta === CANALES_VENTA.PROFESIONAL;
      const precios = activos
        .map((formato) =>
          exclusivo
            ? formato.articulo.precioMayoristaNeto
            : formato.articulo.precioMinoristaNeto,
        )
        .filter((neto) => neto !== null)
        .map((neto) => precioConIva(neto.toNumber(), porcentajeIva));
      const [foto] =
        propios.find((formato) => formato.esPredeterminado)?.articulo
          .imagenes ?? [];
      return {
        ...fila,
        imagen: foto ? urlPublicaArchivo(urlBase, foto.ubicacionArchivo) : null,
        formatos: activos.length,
        precioDesde: precios.length > 0 ? Math.min(...precios) : null,
        stockTotal: propios.reduce(
          (suma, formato) => suma + (unidades.get(formato.id) ?? 0),
          0,
        ),
        stockBajo: bajos.has(fila.id),
      };
    });
  }
}
