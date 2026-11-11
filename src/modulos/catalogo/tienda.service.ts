import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { urlPublicaArchivo } from '../../almacen/almacen-archivos.js';
import { precioConIva } from '../../common/dominio/montos.js';
import { ROLES, type Rol } from '../../common/dominio/roles.js';
import {
  CANALES_VENTA,
  DIAS_MAS_VENDIDOS,
  ESTADOS_SIN_VENTA,
  ORDENES_TIENDA,
} from '../../common/dominio/valores.js';
import { POR_PAGINA } from '../../common/validacion/paginacion.js';
import { escaparComodines } from '../../common/validacion/texto-busqueda.js';
import type { Entorno } from '../../config/entorno.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CacheCatalogo, CLAVES_CACHE } from './cache-catalogo.js';
import { CategoriasService, type NodoCategoria } from './categorias.service.js';
import type {
  FiltrosTiendaDto,
  ListarTiendaDto,
} from './dto/listar-tienda.dto.js';
import { MarcasService } from './marcas.service.js';
/**
 * Un formato se puede vender en la tienda si su artículo está activo, tiene sus dos precios e
 * imagen. El formato nace sin precios (E3-H2) y no se muestra hasta que E3-H5 los fija.
 */
export const FORMATO_VENDIBLE = {
  articulo: {
    activo: true,
    precioMinoristaNeto: { not: null },
    precioMayoristaNeto: { not: null },
    imagenes: { some: {} },
  },
} satisfies Prisma.FormatoProductoWhereInput;

/**
 * Para el profesional (E2-H4): el formato de un producto exclusivo solo necesita el precio
 * mayorista, porque no se vende a minoristas (E3-H5); el de uno general, los dos precios.
 */
export const FORMATO_VENDIBLE_PROFESIONAL = {
  articulo: {
    activo: true,
    precioMayoristaNeto: { not: null },
    imagenes: { some: {} },
  },
  OR: [
    { producto: { canalVenta: CANALES_VENTA.PROFESIONAL } },
    { articulo: { precioMinoristaNeto: { not: null } } },
  ],
} satisfies Prisma.FormatoProductoWhereInput;

/**
 * Producto que la tienda muestra (E2-H1 y E2-H4): activo, sin marca o con la marca activa y con
 * al menos un formato vendible. Solo el profesional ve los exclusivos. El detalle (E2-H3) usa
 * esta misma regla.
 */
export const productoALaVenta = (
  verMayorista: boolean,
): Prisma.ProductoWhereInput => ({
  activo: true,
  canalVenta: verMayorista
    ? { in: [CANALES_VENTA.GENERAL, CANALES_VENTA.PROFESIONAL] }
    : CANALES_VENTA.GENERAL,
  OR: [{ marcaId: null }, { marca: { is: { activa: true } } }],
  formatos: {
    some: verMayorista ? FORMATO_VENDIBLE_PROFESIONAL : FORMATO_VENDIBLE,
  },
});

/** La imagen que la tienda muestra de un artículo: la principal (también la usan los packs). */
export const IMAGEN_PRINCIPAL = {
  select: { ubicacionArchivo: true },
  orderBy: [{ esPrincipal: 'desc' }, { orden: 'asc' }, { id: 'asc' }],
  take: 1,
} satisfies Prisma.ArticuloVenta$imagenesArgs;

/**
 * Lo que la tienda muestra de un producto a quien no es profesional. El `select` es explícito:
 * el precio mayorista nunca se lee para ellos (RNF-04).
 */
const SELECCION = {
  id: true,
  nombre: true,
  marca: { select: { id: true, nombre: true } },
  categoria: { select: { id: true, nombre: true } },
  formatos: {
    where: FORMATO_VENDIBLE,
    select: {
      id: true,
      esPredeterminado: true,
      articulo: {
        select: { precioMinoristaNeto: true, imagenes: IMAGEN_PRINCIPAL },
      },
    },
  },
} satisfies Prisma.ProductoSelect;

/** Lo que ve el profesional: además, el canal y el precio mayorista (E2-H4). */
const SELECCION_PROFESIONAL = {
  ...SELECCION,
  canalVenta: true,
  formatos: {
    where: FORMATO_VENDIBLE_PROFESIONAL,
    select: {
      id: true,
      esPredeterminado: true,
      articulo: {
        select: {
          precioMinoristaNeto: true,
          precioMayoristaNeto: true,
          imagenes: IMAGEN_PRINCIPAL,
        },
      },
    },
  },
} satisfies Prisma.ProductoSelect;

const ORDEN = [
  { nombre: 'asc' },
  { id: 'asc' },
] satisfies Prisma.ProductoOrderByWithRelationInput[];

/** «Novedades»: el producto creado más recientemente primero; el mismo instante, por nombre. */
const ORDEN_NOVEDADES = [
  { fechaCreacion: 'desc' },
  ...ORDEN,
] satisfies Prisma.ProductoOrderByWithRelationInput[];

type FilaProducto = Prisma.ProductoGetPayload<{ select: typeof SELECCION }>;
type FilaProductoProfesional = Prisma.ProductoGetPayload<{
  select: typeof SELECCION_PROFESIONAL;
}>;

export interface ProductoTienda {
  id: number;
  nombre: string;
  marca: { id: number; nombre: string } | null;
  categoria: { id: number; nombre: string };
  /** Precio minorista con IVA incluido, en pesos enteros. */
  precio: number;
  /** URL pública de la imagen principal del formato mostrado. */
  imagen: string;
  /**
   * Id del formato mostrado (es el `articuloId` del carrito): la tarjeta lo agrega directo cuando
   * el producto tiene un solo formato a la venta (SCRUM-157).
   */
  formatoId: number;
  /** Cuántos formatos del producto están a la venta para quien consulta. */
  formatos: number;
}

/** Lo que ve el profesional (E2-H4): los dos precios del mismo formato y si es exclusivo. */
export interface ProductoTiendaProfesional extends Omit<
  ProductoTienda,
  'precio'
> {
  /** Precio minorista con IVA incluido; `null` si el producto es exclusivo para profesionales. */
  precio: number | null;
  /** Precio mayorista con IVA incluido, en pesos enteros. */
  precioMayorista: number;
  exclusivo: boolean;
}

export interface ListadoTienda {
  items: (ProductoTienda | ProductoTiendaProfesional)[];
  total: number;
  pagina: number;
  limite: number;
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
   * Productos de la tienda (E2-H1, E2-H2 y E2-H4; RF-02.01, RF-02.02, RF-02.04, RF-02.05,
   * RF-02.07 y RF-02.08), ordenados por nombre. Solo los activos, sin marca o con la marca
   * activa, y con al menos un formato vendible. Con `categoriaId` incluye sus subcategorías.
   * Con `buscar`, cada palabra debe estar en el nombre, la marca o la categoría (propia o
   * superior). Búsqueda y filtros se exigen a la vez.
   *
   * Solo el `rol` profesional ve los productos exclusivos y el precio mayorista; visitantes,
   * clientes y personal reciben solo los de venta general con el minorista (RNF-04).
   */
  async listarProductos(
    filtros: ListarTiendaDto,
    rol?: Rol,
  ): Promise<ListadoTienda> {
    const verMayorista = rol === ROLES.PROFESIONAL;
    const pagina = filtros.pagina ?? 1;
    const limite = filtros.limite ?? POR_PAGINA;
    const where = this.donde(await this.resolver(filtros, verMayorista));
    // «Más vendidos» se ordena por un dato de los pedidos: primero se eligen los ids de la página
    const idsPagina =
      filtros.orden === ORDENES_TIENDA.MAS_VENDIDOS
        ? await this.paginaMasVendidos(where, pagina, limite)
        : undefined;
    const consulta: {
      where: Prisma.ProductoWhereInput;
      orderBy: Prisma.ProductoOrderByWithRelationInput[];
      skip?: number;
      take?: number;
    } = idsPagina
      ? { where: { id: { in: idsPagina } }, orderBy: ORDEN }
      : {
          where,
          orderBy:
            filtros.orden === ORDENES_TIENDA.NOVEDADES
              ? ORDEN_NOVEDADES
              : ORDEN,
          skip: (pagina - 1) * limite,
          take: limite,
        };
    const enOrden = <T extends { id: number }>(filas: T[]) =>
      idsPagina
        ? idsPagina.flatMap((id) => filas.filter((fila) => fila.id === id))
        : filas;
    const precios: Precios = {
      porcentajeIva: this.config.get('IVA_PORCENTAJE', { infer: true }),
      urlBaseImagenes: this.config.get('R2_URL_PUBLICA', { infer: true }),
    };
    if (verMayorista) {
      const [filas, total] = await this.prisma.$transaction([
        this.prisma.producto.findMany({
          ...consulta,
          select: SELECCION_PROFESIONAL,
        }),
        this.prisma.producto.count({ where }),
      ]);
      const items = enOrden(filas)
        .map((fila) => aProductoProfesional(fila, precios))
        .filter((item) => item !== null);
      return { items, total, pagina, limite };
    }
    const [filas, total] = await this.prisma.$transaction([
      this.prisma.producto.findMany({ ...consulta, select: SELECCION }),
      this.prisma.producto.count({ where }),
    ]);
    const items = enOrden(filas)
      .map((fila) => aProductoTienda(fila, precios))
      .filter((item) => item !== null);
    return { items, total, pagina, limite };
  }

  /**
   * Cuántos productos hay en cada categoría y en cada marca con la búsqueda y los filtros
   * (E2-H2, SCRUM-150), para los conteos de los filtros. Las mismas reglas de visibilidad que el
   * listado. Cada grupo cuenta con la búsqueda y los filtros del **otro** grupo: marcar una
   * categoría no deja en 0 a las demás. El total de una categoría incluye sus subcategorías.
   * Solo vienen las opciones con productos.
   */
  async facetas(filtros: FiltrosTiendaDto, rol?: Rol): Promise<FacetasTienda> {
    const resueltos = await this.resolver(filtros, rol === ROLES.PROFESIONAL);
    const filasCategorias =
      resueltos.filasCategorias.length > 0
        ? resueltos.filasCategorias
        : await this.leerCategorias();
    const [porCategoria, porMarca] = await Promise.all([
      this.prisma.producto.groupBy({
        by: ['categoriaId'],
        where: this.donde(resueltos, { sinCategorias: true }),
        _count: { _all: true },
      }),
      this.prisma.producto.groupBy({
        by: ['marcaId'],
        where: {
          ...this.donde(resueltos, { sinMarcas: true }),
          marcaId: { not: null },
        },
        _count: { _all: true },
      }),
    ]);
    const enCategoria = new Map(
      porCategoria.map((fila) => [fila.categoriaId, fila._count._all]),
    );
    const categorias = filasCategorias
      .map((categoria) => ({
        id: categoria.id,
        total: conDescendientes(filasCategorias, [categoria.id]).reduce(
          (suma, id) => suma + (enCategoria.get(id) ?? 0),
          0,
        ),
      }))
      .filter((faceta) => faceta.total > 0)
      .sort((a, b) => a.id - b.id);
    const marcas = porMarca
      .filter((fila) => fila.marcaId !== null && fila._count._all > 0)
      .map((fila) => ({ id: fila.marcaId as number, total: fila._count._all }))
      .sort((a, b) => a.id - b.id);
    return { categorias, marcas };
  }

  /**
   * Los ids de una página de «más vendidos»: unidades de sus formatos vendidas en los últimos
   * `DIAS_MAS_VENDIDOS` días en pedidos que son venta; los empates (y los sin ventas), por
   * nombre. Ordena en memoria los productos que cumplen los filtros: el catálogo de la tienda es
   * chico (cientos de productos).
   */
  private async paginaMasVendidos(
    where: Prisma.ProductoWhereInput,
    pagina: number,
    limite: number,
  ): Promise<number[]> {
    const [productos, ventas] = await Promise.all([
      this.prisma.producto.findMany({
        where,
        select: { id: true, nombre: true },
        orderBy: ORDEN,
      }),
      this.prisma.$queryRaw<{ productoId: number; unidades: bigint }[]>`
        SELECT f.id_producto AS "productoId", SUM(dp.cantidad)::bigint AS unidades
        FROM detalle_pedido dp
        JOIN pedido p ON p.id_pedido = dp.id_pedido
        JOIN formato_producto f ON f.id_formato = dp.id_articulo
        WHERE p.fecha_pedido >= now() - make_interval(days => ${DIAS_MAS_VENDIDOS}::int)
          AND p.estado_actual <> ALL(${ESTADOS_SIN_VENTA}::text[])
        GROUP BY f.id_producto`,
    ]);
    const unidades = new Map(
      ventas.map((fila) => [fila.productoId, Number(fila.unidades)]),
    );
    // `productos` ya viene por nombre: el orden estable deja los empates así
    return productos
      .map((producto, indice) => ({
        id: producto.id,
        indice,
        vendidas: unidades.get(producto.id) ?? 0,
      }))
      .sort((a, b) => b.vendidas - a.vendidas || a.indice - b.indice)
      .slice((pagina - 1) * limite, pagina * limite)
      .map((producto) => producto.id);
  }

  /**
   * Comprueba los filtros y los deja listos para consultar: las palabras de la búsqueda, las
   * categorías con sus subcategorías y las marcas. Una categoría inexistente, o una marca que no
   * existe o no está activa, responde 404 como hasta ahora.
   */
  private async resolver(
    filtros: FiltrosTiendaDto,
    verMayorista: boolean,
  ): Promise<FiltrosResueltos> {
    // Una palabra repetida no cambia el resultado: se busca una vez
    const palabras = [
      ...new Set(
        filtros.buscar?.toLocaleLowerCase('es').split(/\s+/).filter(Boolean) ??
          [],
      ),
    ];
    const categoriaIds = [...new Set(filtros.categoriaId ?? [])];
    const marcaIds = [...new Set(filtros.marcaId ?? [])];
    const filasCategorias =
      categoriaIds.length > 0 || palabras.length > 0
        ? await this.leerCategorias()
        : [];
    let categorias: number[] | undefined;
    if (categoriaIds.length > 0) {
      const existentes = new Set(filasCategorias.map((fila) => fila.id));
      if (categoriaIds.some((id) => !existentes.has(id))) {
        throw new NotFoundException('La categoría no existe.');
      }
      categorias = conDescendientes(filasCategorias, categoriaIds);
    }
    if (marcaIds.length > 0) {
      await this.exigirMarcasActivas(marcaIds);
    }
    return {
      verMayorista,
      palabras,
      filasCategorias,
      categorias,
      marcas: marcaIds.length > 0 ? marcaIds : undefined,
    };
  }

  /** El `where` de los productos; las facetas dejan fuera el filtro de su propio grupo. */
  private donde(
    {
      verMayorista,
      palabras,
      filasCategorias,
      categorias,
      marcas,
    }: FiltrosResueltos,
    { sinCategorias = false, sinMarcas = false } = {},
  ): Prisma.ProductoWhereInput {
    return {
      ...productoALaVenta(verMayorista),
      categoriaId:
        categorias && !sinCategorias ? { in: categorias } : undefined,
      marcaId: marcas && !sinMarcas ? { in: marcas } : undefined,
      AND:
        palabras.length > 0
          ? palabras.map((palabra) =>
              condicionPalabra(palabra, filasCategorias),
            )
          : undefined,
    };
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

  /** Todas las marcas indicadas existen y están activas; si no, 404. */
  private async exigirMarcasActivas(marcaIds: number[]) {
    const activas = await this.prisma.marca.count({
      where: { id: { in: marcaIds }, activa: true },
    });
    if (activas !== marcaIds.length) {
      throw new NotFoundException('La marca no existe.');
    }
  }
}

/** Los filtros comprobados, listos para armar el `where`. */
interface FiltrosResueltos {
  verMayorista: boolean;
  palabras: string[];
  filasCategorias: FilaCategoria[];
  categorias?: number[];
  marcas?: number[];
}

/** Cuántos productos hay en una categoría (con sus subcategorías) o en una marca. */
export interface FacetaTienda {
  id: number;
  total: number;
}

export interface FacetasTienda {
  categorias: FacetaTienda[];
  marcas: FacetaTienda[];
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
  const contiene = {
    contains: escaparComodines(palabra),
    mode: 'insensitive',
  } as const;
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

interface Precios {
  porcentajeIva: number;
  urlBaseImagenes: string | undefined;
}

interface FormatoCandidato {
  id: number;
  esPredeterminado: boolean;
  articulo: { imagenes: { ubicacionArchivo: string }[] };
}

/**
 * Elige el formato que representa al producto: el predeterminado si se puede vender; si no,
 * el más barato según `neto` (el precio que ve quien consulta).
 */
const elegirFormato = <F extends FormatoCandidato>(
  formatos: F[],
  neto: (formato: F) => number,
) =>
  formatos
    .filter((formato) => formato.articulo.imagenes[0] !== undefined)
    .sort(
      (a, b) =>
        Number(b.esPredeterminado) - Number(a.esPredeterminado) ||
        neto(a) - neto(b),
    )[0];

/** Los datos del producto que ven todos, con la imagen del formato elegido. */
const datosComunes = (
  fila: FilaProducto | FilaProductoProfesional,
  formato: FormatoCandidato,
  { urlBaseImagenes }: Precios,
) => ({
  id: fila.id,
  nombre: fila.nombre,
  marca: fila.marca,
  categoria: fila.categoria,
  imagen: urlPublicaArchivo(
    urlBaseImagenes,
    formato.articulo.imagenes[0]!.ubicacionArchivo,
  ),
  formatoId: formato.id,
  formatos: fila.formatos.length,
});

/** Para quien no es profesional. El precio va con IVA, en pesos enteros, como lo cobrará el pedido. */
const aProductoTienda = (
  fila: FilaProducto,
  precios: Precios,
): ProductoTienda | null => {
  const elegido = elegirFormato(fila.formatos, (formato) =>
    Number(formato.articulo.precioMinoristaNeto),
  );
  if (!elegido) {
    return null;
  }
  return {
    ...datosComunes(fila, elegido, precios),
    precio: precioConIva(
      Number(elegido.articulo.precioMinoristaNeto),
      precios.porcentajeIva,
    ),
  };
};

/**
 * Para el profesional (E2-H4): el formato se elige por el mayorista y los dos precios salen de
 * ese mismo formato. Un exclusivo no muestra el minorista aunque lo tenga guardado (E3-H5).
 */
const aProductoProfesional = (
  fila: FilaProductoProfesional,
  precios: Precios,
): ProductoTiendaProfesional | null => {
  const elegido = elegirFormato(fila.formatos, (formato) =>
    Number(formato.articulo.precioMayoristaNeto),
  );
  if (!elegido) {
    return null;
  }
  const exclusivo = fila.canalVenta === CANALES_VENTA.PROFESIONAL;
  const { precioMinoristaNeto, precioMayoristaNeto } = elegido.articulo;
  return {
    ...datosComunes(fila, elegido, precios),
    precio:
      exclusivo || precioMinoristaNeto === null
        ? null
        : precioConIva(Number(precioMinoristaNeto), precios.porcentajeIva),
    precioMayorista: precioConIva(
      Number(precioMayoristaNeto),
      precios.porcentajeIva,
    ),
    exclusivo,
  };
};
