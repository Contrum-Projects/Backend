import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { urlPublicaArchivo } from '../../almacen/almacen-archivos.js';
import { hoyEnLaTienda } from '../../common/dominio/fechas.js';
import { precioConIva } from '../../common/dominio/montos.js';
import { ROLES, type Rol } from '../../common/dominio/roles.js';
import { CANALES_VENTA } from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  type Disponibilidad,
  disponibilidad,
  stockVendible,
  unidadesDeFormato,
  unidadesDePack,
} from './disponibilidad.js';
import {
  aPackProfesional,
  aPackTienda,
  COMPONENTES,
  packsGenerales,
  packsProfesional,
  type PackTienda,
  type PackTiendaProfesional,
  SELECCION as SELECCION_PACK,
  SELECCION_PROFESIONAL as SELECCION_PACK_PROFESIONAL,
} from './tienda-packs.service.js';
import {
  FORMATO_VENDIBLE,
  FORMATO_VENDIBLE_PROFESIONAL,
  IMAGEN_PRINCIPAL,
  productoALaVenta,
} from './tienda.service.js';

/** Todas las imágenes del artículo, la principal primero y luego en su orden. */
const IMAGENES = {
  select: IMAGEN_PRINCIPAL.select,
  orderBy: IMAGEN_PRINCIPAL.orderBy,
} satisfies Prisma.ArticuloVenta$imagenesArgs;

const DATOS_FORMATO = {
  id: true,
  nombreFormato: true,
  contenido: true,
  unidadMedida: true,
  esPredeterminado: true,
} satisfies Prisma.FormatoProductoSelect;

/** El predeterminado primero; después, en el orden en que se crearon. */
const ORDEN_FORMATOS = [
  { esPredeterminado: 'desc' },
  { id: 'asc' },
] satisfies Prisma.FormatoProductoOrderByWithRelationInput[];

/**
 * Lo que la tienda muestra del producto a quien no es profesional: solo sus formatos vendibles.
 * El `select` es explícito: el precio mayorista nunca se lee para ellos (RNF-04).
 */
const DETALLE = {
  id: true,
  nombre: true,
  descripcion: true,
  marca: { select: { id: true, nombre: true } },
  categoria: { select: { id: true, nombre: true } },
  formatos: {
    where: FORMATO_VENDIBLE,
    orderBy: ORDEN_FORMATOS,
    select: {
      ...DATOS_FORMATO,
      articulo: { select: { precioMinoristaNeto: true, imagenes: IMAGENES } },
    },
  },
} satisfies Prisma.ProductoSelect;

/** Lo que ve el profesional: además, el canal y el precio mayorista (como en E2-H4). */
const DETALLE_PROFESIONAL = {
  ...DETALLE,
  canalVenta: true,
  formatos: {
    where: FORMATO_VENDIBLE_PROFESIONAL,
    orderBy: ORDEN_FORMATOS,
    select: {
      ...DATOS_FORMATO,
      articulo: {
        select: {
          precioMinoristaNeto: true,
          precioMayoristaNeto: true,
          imagenes: IMAGENES,
        },
      },
    },
  },
} satisfies Prisma.ProductoSelect;

/** El pack como en el listado (E3-H6), con todas sus imágenes y el id de cada componente. */
const COMPONENTES_DETALLE = {
  ...COMPONENTES,
  select: { ...COMPONENTES.select, formatoId: true },
} satisfies Prisma.Pack$componentesArgs;

const DETALLE_PACK = {
  ...SELECCION_PACK,
  articulo: { select: { precioMinoristaNeto: true, imagenes: IMAGENES } },
  componentes: COMPONENTES_DETALLE,
} satisfies Prisma.PackSelect;

const DETALLE_PACK_PROFESIONAL = {
  ...SELECCION_PACK_PROFESIONAL,
  articulo: {
    select: {
      precioMinoristaNeto: true,
      precioMayoristaNeto: true,
      imagenes: IMAGENES,
    },
  },
  componentes: COMPONENTES_DETALLE,
} satisfies Prisma.PackSelect;

type FilaFormato = Prisma.ProductoGetPayload<{
  select: typeof DETALLE;
}>['formatos'][number];
type FilaFormatoProfesional = Prisma.ProductoGetPayload<{
  select: typeof DETALLE_PROFESIONAL;
}>['formatos'][number];

export interface FormatoDetalle {
  id: number;
  nombre: string;
  contenido: number | null;
  unidadMedida: string | null;
  esPredeterminado: boolean;
  /** URLs públicas de sus imágenes, la principal primero. */
  imagenes: string[];
  /** Precio minorista con IVA incluido, en pesos enteros. */
  precio: number;
  disponibilidad: Disponibilidad;
}

/** Lo que ve el profesional de cada formato (como en E2-H4). */
export interface FormatoDetalleProfesional extends Omit<
  FormatoDetalle,
  'precio'
> {
  /** Precio minorista con IVA; `null` si el producto es exclusivo para profesionales. */
  precio: number | null;
  /** Precio mayorista con IVA incluido, en pesos enteros. */
  precioMayorista: number;
}

export interface ProductoDetalle {
  id: number;
  nombre: string;
  descripcion: string;
  marca: { id: number; nombre: string } | null;
  categoria: { id: number; nombre: string };
  formatos: FormatoDetalle[];
}

export interface ProductoDetalleProfesional extends Omit<
  ProductoDetalle,
  'formatos'
> {
  exclusivo: boolean;
  formatos: FormatoDetalleProfesional[];
}

interface DatosDetallePack {
  /** URLs públicas de sus imágenes, la principal primero. */
  imagenes: string[];
  /** La de su componente más escaso (criterio 3). */
  disponibilidad: Disponibilidad;
}

export type PackDetalle = PackTienda & DatosDetallePack;
export type PackDetalleProfesional = PackTiendaProfesional & DatosDetallePack;

@Injectable()
export class TiendaDetalleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
  ) {}

  /**
   * Detalle de un producto (E2-H3; RF-02.03, RF-02.06 y RF-02.09): sus formatos vendibles, cada
   * uno con sus imágenes, su precio con IVA y si está disponible o agotado. Se ve con la misma
   * regla del listado (E2-H4): lo que el listado no muestra a ese `rol` responde 404, sin revelar
   * si existe. Solo el profesional recibe el mayorista (RNF-04). Sin caché: lleva precios y stock.
   */
  async obtenerProducto(
    id: number,
    rol?: Rol,
  ): Promise<ProductoDetalle | ProductoDetalleProfesional> {
    const porcentajeIva = this.config.get('IVA_PORCENTAJE', { infer: true });
    if (rol === ROLES.PROFESIONAL) {
      const fila = await this.prisma.producto.findFirst({
        where: { id, ...productoALaVenta(true) },
        select: DETALLE_PROFESIONAL,
      });
      if (!fila) {
        throw new NotFoundException('El producto no existe.');
      }
      const stock = await this.stockDe(fila.formatos);
      const exclusivo = fila.canalVenta === CANALES_VENTA.PROFESIONAL;
      return {
        id: fila.id,
        nombre: fila.nombre,
        descripcion: fila.descripcion,
        marca: fila.marca,
        categoria: fila.categoria,
        exclusivo,
        formatos: fila.formatos.map((formato) => {
          const { precioMinoristaNeto, precioMayoristaNeto } = formato.articulo;
          return {
            ...this.datosFormato(formato, stock),
            precio:
              exclusivo || precioMinoristaNeto === null
                ? null
                : precioConIva(Number(precioMinoristaNeto), porcentajeIva),
            precioMayorista: precioConIva(
              Number(precioMayoristaNeto),
              porcentajeIva,
            ),
          };
        }),
      };
    }
    const fila = await this.prisma.producto.findFirst({
      where: { id, ...productoALaVenta(false) },
      select: DETALLE,
    });
    if (!fila) {
      throw new NotFoundException('El producto no existe.');
    }
    const stock = await this.stockDe(fila.formatos);
    return {
      ...fila,
      formatos: fila.formatos.map((formato) => ({
        ...this.datosFormato(formato, stock),
        precio: precioConIva(
          Number(formato.articulo.precioMinoristaNeto),
          porcentajeIva,
        ),
      })),
    };
  }

  /**
   * Detalle de un pack (E2-H3, criterio 3): lo mismo que el listado de packs (E3-H6), con todas
   * sus imágenes y la disponibilidad de su componente más escaso. Un pack que el listado no
   * muestra a ese `rol` (fuera de vigencia, exclusivo, sin precios) responde 404.
   */
  async obtenerPack(
    id: number,
    rol?: Rol,
  ): Promise<PackDetalle | PackDetalleProfesional> {
    const hoy = hoyEnLaTienda();
    const porcentajeIva = this.config.get('IVA_PORCENTAJE', { infer: true });
    const urlBase = this.config.get('R2_URL_PUBLICA', { infer: true });
    if (rol === ROLES.PROFESIONAL) {
      const fila = await this.prisma.pack.findFirst({
        where: { id, ...packsProfesional(hoy) },
        select: DETALLE_PACK_PROFESIONAL,
      });
      if (!fila) {
        throw new NotFoundException('El pack no existe.');
      }
      return {
        ...aPackProfesional(fila, porcentajeIva, urlBase),
        ...(await this.datosPack(fila)),
      };
    }
    const fila = await this.prisma.pack.findFirst({
      where: { id, ...packsGenerales(hoy) },
      select: DETALLE_PACK,
    });
    if (!fila) {
      throw new NotFoundException('El pack no existe.');
    }
    return {
      ...aPackTienda(fila, porcentajeIva, urlBase),
      ...(await this.datosPack(fila)),
    };
  }

  private stockDe(formatos: { id: number }[]) {
    return stockVendible(
      this.prisma,
      formatos.map((formato) => formato.id),
    );
  }

  private urlDe(imagenes: { ubicacionArchivo: string }[]) {
    const urlBase = this.config.get('R2_URL_PUBLICA', { infer: true });
    return imagenes.map((imagen) =>
      urlPublicaArchivo(urlBase, imagen.ubicacionArchivo),
    );
  }

  /** Los datos del formato que ven todos, sin los precios. */
  private datosFormato(
    formato: FilaFormato | FilaFormatoProfesional,
    stock: Map<number, number>,
  ) {
    return {
      id: formato.id,
      nombre: formato.nombreFormato,
      contenido: formato.contenido === null ? null : Number(formato.contenido),
      unidadMedida: formato.unidadMedida,
      esPredeterminado: formato.esPredeterminado,
      imagenes: this.urlDe(formato.articulo.imagenes),
      disponibilidad: disponibilidad(unidadesDeFormato(stock, formato.id)),
    };
  }

  private async datosPack(fila: {
    articulo: { imagenes: { ubicacionArchivo: string }[] };
    componentes: { formatoId: number; cantidad: number }[];
  }): Promise<DatosDetallePack> {
    const stock = await stockVendible(
      this.prisma,
      fila.componentes.map((componente) => componente.formatoId),
    );
    return {
      imagenes: this.urlDe(fila.articulo.imagenes),
      disponibilidad: disponibilidad(unidadesDePack(fila.componentes, stock)),
    };
  }
}
