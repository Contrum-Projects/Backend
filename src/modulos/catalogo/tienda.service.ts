import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { urlPublicaArchivo } from '../../almacen/almacen-archivos.js';
import { calcularMontos } from '../../common/dominio/montos.js';
import { CANALES_VENTA } from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CacheCatalogo, CLAVES_CACHE } from './cache-catalogo.js';
import { CategoriasService, type NodoCategoria } from './categorias.service.js';
import type { ListarTiendaDto } from './dto/listar-tienda.dto.js';
import { MarcasService } from './marcas.service.js';

const POR_PAGINA = 20;

/**
 * Un formato se puede vender en la tienda si su artículo está activo, tiene sus dos precios e
 * imagen. El formato nace sin precios (E3-H2) y no se muestra hasta que E3-H5 los fija.
 */
const FORMATO_VENDIBLE = {
  articulo: {
    activo: true,
    precioMinoristaNeto: { not: null },
    precioMayoristaNeto: { not: null },
    imagenes: { some: {} },
  },
} satisfies Prisma.FormatoProductoWhereInput;

/**
 * Lo que la tienda muestra de un producto. El `select` es explícito: el precio mayorista
 * nunca se lee para el listado público (RNF-04).
 */
const SELECCION = {
  id: true,
  nombre: true,
  marca: { select: { id: true, nombre: true } },
  categoria: { select: { id: true, nombre: true } },
  formatos: {
    where: FORMATO_VENDIBLE,
    select: {
      esPredeterminado: true,
      articulo: {
        select: {
          precioMinoristaNeto: true,
          imagenes: {
            select: { ubicacionArchivo: true },
            orderBy: [{ esPrincipal: 'desc' }, { orden: 'asc' }, { id: 'asc' }],
            take: 1,
          },
        },
      },
    },
  },
} satisfies Prisma.ProductoSelect;

type FilaProducto = Prisma.ProductoGetPayload<{ select: typeof SELECCION }>;

export interface ProductoTienda {
  id: number;
  nombre: string;
  marca: { id: number; nombre: string } | null;
  categoria: { id: number; nombre: string };
  /** Precio minorista con IVA incluido, en pesos enteros. */
  precio: number;
  /** URL pública de la imagen principal del formato mostrado. */
  imagen: string;
}

export interface MarcaTienda {
  id: number;
  nombre: string;
}

@Injectable()
export class TiendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
    private readonly cache: CacheCatalogo,
    private readonly categorias: CategoriasService,
    private readonly marcas: MarcasService,
  ) {}

  /**
   * Productos de la tienda (E2-H1 y E2-H2, RF-02.01, RF-02.02, RF-02.07 y RF-02.08), ordenados
   * por nombre. Solo los activos, de venta general (los exclusivos llegan con E2-H4), sin marca
   * o con la marca activa, y con al menos un formato vendible. Con `categoriaId` incluye sus
   * subcategorías. Con `buscar`, cada palabra debe estar en el nombre, la marca o la categoría
   * (propia o superior). Búsqueda y filtros se exigen a la vez.
   */
  async listarProductos(filtros: ListarTiendaDto) {
    const pagina = filtros.pagina ?? 1;
    const limite = filtros.limite ?? POR_PAGINA;
    // Una palabra repetida no cambia el resultado: se busca una vez
    const palabras = [
      ...new Set(
        filtros.buscar?.toLocaleLowerCase('es').split(/\s+/).filter(Boolean) ??
          [],
      ),
    ];
    const filasCategorias =
      filtros.categoriaId !== undefined || palabras.length > 0
        ? await this.leerCategorias()
        : [];
    let categorias: number[] | undefined;
    if (filtros.categoriaId !== undefined) {
      if (!filasCategorias.some((fila) => fila.id === filtros.categoriaId)) {
        throw new NotFoundException('La categoría no existe.');
      }
      categorias = conDescendientes(filasCategorias, [filtros.categoriaId]);
    }
    if (filtros.marcaId !== undefined) {
      await this.exigirMarcaActiva(filtros.marcaId);
    }
    const where: Prisma.ProductoWhereInput = {
      activo: true,
      canalVenta: CANALES_VENTA.GENERAL,
      OR: [{ marcaId: null }, { marca: { is: { activa: true } } }],
      formatos: { some: FORMATO_VENDIBLE },
      categoriaId: categorias ? { in: categorias } : undefined,
      marcaId: filtros.marcaId,
      AND:
        palabras.length > 0
          ? palabras.map((palabra) =>
              condicionPalabra(palabra, filasCategorias),
            )
          : undefined,
    };
    const [filas, total] = await this.prisma.$transaction([
      this.prisma.producto.findMany({
        where,
        select: SELECCION,
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
        skip: (pagina - 1) * limite,
        take: limite,
      }),
      this.prisma.producto.count({ where }),
    ]);
    const porcentajeIva = this.config.get('IVA_PORCENTAJE', { infer: true });
    const urlBaseImagenes = this.config.get('R2_URL_PUBLICA', { infer: true });
    const items = filas
      .map((fila) => aProductoTienda(fila, porcentajeIva, urlBaseImagenes))
      .filter((item): item is ProductoTienda => item !== null);
    return { items, total, pagina, limite };
  }

  /** Árbol de categorías para navegar la tienda, desde la caché si está (RNF-30). */
  listarCategorias(): Promise<NodoCategoria[]> {
    return this.cache.obtener(CLAVES_CACHE.CATEGORIAS, () =>
      this.categorias.listarArbol(),
    );
  }

  /** Marcas activas para navegar la tienda, desde la caché si está (RNF-30). */
  listarMarcas(): Promise<MarcaTienda[]> {
    return this.cache.obtener(CLAVES_CACHE.MARCAS, async () => {
      const marcas = await this.marcas.listar();
      return marcas.map(({ id, nombre }) => ({ id, nombre }));
    });
  }

  /**
   * Todas las categorías, para resolver subcategorías y búsquedas. Se lee de la base y no de
   * la caché: el filtro de productos no debe depender de una copia que puede estar vieja.
   */
  private leerCategorias(): Promise<FilaCategoria[]> {
    return this.prisma.categoria.findMany({
      select: { id: true, padreId: true, nombre: true },
    });
  }

  private async exigirMarcaActiva(marcaId: number) {
    const marca = await this.prisma.marca.findUnique({
      where: { id: marcaId },
      select: { activa: true },
    });
    if (!marca?.activa) {
      throw new NotFoundException('La marca no existe.');
    }
  }
}

interface FilaCategoria {
  id: number;
  padreId: number | null;
  nombre: string;
}

/** Las categorías indicadas más todas sus subcategorías, a cualquier profundidad. */
const conDescendientes = (filas: FilaCategoria[], raices: number[]) => {
  const ids = [...raices];
  for (let i = 0; i < ids.length; i++) {
    for (const fila of filas) {
      if (fila.padreId === ids[i] && !ids.includes(fila.id)) {
        ids.push(fila.id);
      }
    }
  }
  return ids;
};

/**
 * Una palabra de la búsqueda coincide si está en el nombre del producto, en el de su marca o
 * en el de su categoría o una superior (la categoría alcanza a sus subcategorías).
 */
const condicionPalabra = (
  palabra: string,
  categorias: FilaCategoria[],
): Prisma.ProductoWhereInput => {
  const buscada = palabra.toLocaleLowerCase('es');
  const coincidentes = categorias
    .filter((fila) => fila.nombre.toLocaleLowerCase('es').includes(buscada))
    .map((fila) => fila.id);
  // Prisma no escapa los comodines de ILIKE: sin esto, «%» o «_» coincidirían con cualquier texto
  const literal = palabra.replace(/[\\%_]/g, '\\$&');
  const contiene = { contains: literal, mode: 'insensitive' } as const;
  return {
    OR: [
      { nombre: contiene },
      { marca: { is: { nombre: contiene } } },
      ...(coincidentes.length > 0
        ? [{ categoriaId: { in: conDescendientes(categorias, coincidentes) } }]
        : []),
    ],
  };
};

/**
 * Elige el formato que representa al producto: el predeterminado si se puede vender; si no,
 * el más barato. El precio va con IVA, en pesos enteros, igual que lo cobrará el pedido.
 */
const aProductoTienda = (
  fila: FilaProducto,
  porcentajeIva: number,
  urlBaseImagenes: string | undefined,
): ProductoTienda | null => {
  const formatos = fila.formatos
    .map((formato) => ({
      esPredeterminado: formato.esPredeterminado,
      neto: Number(formato.articulo.precioMinoristaNeto),
      imagen: formato.articulo.imagenes[0]?.ubicacionArchivo,
    }))
    .filter((formato) => formato.imagen !== undefined)
    .sort(
      (a, b) =>
        Number(b.esPredeterminado) - Number(a.esPredeterminado) ||
        a.neto - b.neto,
    );
  const elegido = formatos[0];
  if (!elegido?.imagen) {
    return null;
  }
  return {
    id: fila.id,
    nombre: fila.nombre,
    marca: fila.marca,
    categoria: fila.categoria,
    precio: calcularMontos(Math.round(elegido.neto), porcentajeIva).total,
    imagen: urlPublicaArchivo(urlBaseImagenes, elegido.imagen),
  };
};
