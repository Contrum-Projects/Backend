import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { urlPublicaArchivo } from '../../almacen/almacen-archivos.js';
import type { Entorno } from '../../config/entorno.js';
import { Prisma } from '../../generated/prisma/client.js';
import { POR_PAGINA } from '../../common/validacion/paginacion.js';
import { escaparComodines } from '../../common/validacion/texto-busqueda.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ListarStockDto } from './dto/listar-stock.dto.js';
import type {
  ListadoStockDto,
  StockListadoDto,
} from './dto/stock-listado.dto.js';

interface FilaPagina {
  id: number;
  bajo: boolean;
}

interface FilaConteo {
  total: bigint;
  bajos: bigint;
}

/**
 * Listado de stock del panel (E11-H5 criterio 1, SCRUM-150). Solo lectura desde PostgreSQL: el
 * stock nunca se guarda en caché.
 */
@Injectable()
export class ListadoStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
  ) {}

  /**
   * Un formato por fila (también los desactivados y los que nunca se recibieron, con stock 0),
   * por producto y formato. Con bodega, solo los que tienen unidades en ella, y sus ubicaciones y
   * stock son los de esa bodega. `bajoMinimo` usa la regla del aviso (E11-H6): el stock total en
   * todas las ubicaciones bajo un mínimo mayor que 0. El costo y el proveedor son los de la
   * entrada más reciente, como en la consulta de un formato.
   */
  async listar(filtros: ListarStockDto): Promise<ListadoStockDto> {
    const pagina = filtros.pagina ?? 1;
    const limite = filtros.limite ?? POR_PAGINA;
    const base = this.base(filtros);

    const [conteo] = await this.prisma.$queryRaw<FilaConteo[]>`
      SELECT COUNT(*)::bigint AS total, COUNT(*) FILTER (WHERE bajo)::bigint AS bajos
      FROM (${base}) AS base`;
    const filas = await this.prisma.$queryRaw<FilaPagina[]>`
      SELECT id, bajo FROM (${base}) AS base
      ${filtros.bajoMinimo ? Prisma.sql`WHERE bajo` : Prisma.empty}
      ORDER BY producto, nombre_formato, id
      LIMIT ${limite} OFFSET ${(pagina - 1) * limite}`;

    const items = await this.detalle(filas, filtros.bodegaId);
    return {
      items,
      total: Number(filtros.bajoMinimo ? conteo.bajos : conteo.total),
      pagina,
      limite,
      totalBajoMinimo: Number(conteo.bajos),
    };
  }

  /** Los formatos que cumplen la bodega y la búsqueda, con lo necesario para ordenar y contar. */
  private base({ bodegaId, buscar }: ListarStockDto) {
    const texto = buscar ? `%${escaparComodines(buscar)}%` : null;
    return Prisma.sql`
      SELECT f.id_formato AS id, p.nombre AS producto, f.nombre_formato,
             f.stock_minimo > 0 AND COALESCE(
               (SELECT SUM(e.cantidad) FROM existencia e WHERE e.id_formato = f.id_formato), 0
             ) < f.stock_minimo AS bajo
      FROM formato_producto f
      JOIN articulo_venta a ON a.id_articulo = f.id_formato
      JOIN producto p ON p.id_producto = f.id_producto
      WHERE TRUE
      ${
        texto
          ? Prisma.sql`AND (p.nombre ILIKE ${texto} OR f.nombre_formato ILIKE ${texto} OR a.sku ILIKE ${texto})`
          : Prisma.empty
      }
      ${
        bodegaId
          ? Prisma.sql`AND EXISTS (
              SELECT 1 FROM existencia e JOIN ubicacion u ON u.id_ubicacion = e.id_ubicacion
              WHERE e.id_formato = f.id_formato AND e.cantidad > 0 AND u.id_bodega = ${bodegaId})`
          : Prisma.empty
      }`;
  }

  /** Arma cada fila de la página en el orden en que llegó. */
  private async detalle(
    filas: FilaPagina[],
    bodegaId: number | undefined,
  ): Promise<StockListadoDto[]> {
    if (filas.length === 0) {
      return [];
    }
    const formatos = await this.prisma.formatoProducto.findMany({
      where: { id: { in: filas.map((fila) => fila.id) } },
      select: {
        id: true,
        nombreFormato: true,
        stockMinimo: true,
        producto: { select: { nombre: true } },
        articulo: {
          select: {
            sku: true,
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
        existencias: {
          where: {
            cantidad: { gt: 0 },
            ubicacion: bodegaId ? { bodegaId } : undefined,
          },
          select: {
            cantidad: true,
            ubicacion: { select: { id: true, codigo: true } },
          },
          orderBy: [{ ubicacion: { codigo: 'asc' } }, { ubicacionId: 'asc' }],
        },
        // Como en la consulta de un formato: manda la fecha de recepción y, el mismo día, la
        // entrada registrada después
        detallesEntrada: {
          orderBy: [
            { entrada: { fechaRecepcion: 'desc' } },
            { entrada: { id: 'desc' } },
          ],
          take: 1,
          select: {
            costoUnitarioNeto: true,
            entrada: {
              select: {
                proveedor: { select: { id: true, razonSocial: true } },
              },
            },
          },
        },
      },
    });
    const porId = new Map(formatos.map((formato) => [formato.id, formato]));
    const urlBase = this.config.get('R2_URL_PUBLICA', { infer: true });

    return filas.flatMap(({ id, bajo }) => {
      const formato = porId.get(id);
      if (!formato) {
        return [];
      }
      const [imagen] = formato.articulo.imagenes;
      const [ultima] = formato.detallesEntrada;
      return [
        {
          formatoId: formato.id,
          sku: formato.articulo.sku,
          producto: formato.producto.nombre,
          nombreFormato: formato.nombreFormato,
          imagen: imagen
            ? urlPublicaArchivo(urlBase, imagen.ubicacionArchivo)
            : null,
          ubicaciones: formato.existencias.map(({ ubicacion }) => ubicacion),
          stock: formato.existencias.reduce(
            (suma, existencia) => suma + existencia.cantidad,
            0,
          ),
          stockMinimo: formato.stockMinimo,
          bajoMinimo: bajo,
          ultimaEntrada: ultima
            ? {
                costoUnitarioNeto: ultima.costoUnitarioNeto.toNumber(),
                proveedor: ultima.entrada.proveedor,
              }
            : null,
        },
      ];
    });
  }
}
