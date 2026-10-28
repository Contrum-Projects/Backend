import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { urlPublicaArchivo } from '../../almacen/almacen-archivos.js';
import { hoyEnLaTienda } from '../../common/dominio/fechas.js';
import { precioConIva } from '../../common/dominio/montos.js';
import { ROLES, type Rol } from '../../common/dominio/roles.js';
import { TIPOS_ARTICULO } from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { bloquearCuenta } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  stockVendible,
  unidadesDeFormato,
  unidadesDePack,
} from '../catalogo/disponibilidad.js';
import {
  packsGenerales,
  packsProfesional,
} from '../catalogo/tienda-packs.service.js';
import {
  FORMATO_VENDIBLE,
  FORMATO_VENDIBLE_PROFESIONAL,
  IMAGEN_PRINCIPAL,
  productoALaVenta,
} from '../catalogo/tienda.service.js';
import {
  type AgregarArticuloCarritoDto,
  type CambiarCantidadCarritoDto,
  MAXIMO_UNIDADES_LINEA,
} from './dto/articulo-carrito.dto.js';

const NO_ESTA_EN_EL_CARRITO = 'El artículo no está en el carrito.';

type Cliente = Prisma.TransactionClient | PrismaService;

/** Un artículo de la tienda en el carrito, con su precio y sus existencias (E5-H1). */
export interface LineaCarrito {
  articuloId: number;
  /** `formato` o `pack` (`TIPOS_ARTICULO`). */
  tipo: string;
  /** Nombre del producto, o del pack. */
  nombre: string;
  /** Nombre del formato; `null` en un pack. */
  nombreFormato: string | null;
  /** URL pública de su imagen principal; `null` si no tiene. */
  imagen: string | null;
  cantidad: number;
  /** Precio unitario con IVA, en pesos; `null` si el artículo ya no se vende a esta cuenta. */
  precioUnitario: number | null;
  /** `precioUnitario` por `cantidad`; `null` si el artículo ya no se vende a esta cuenta. */
  subtotal: number | null;
  /** Si hoy la tienda lo vende a esta cuenta (activo, con precio, vigente y visible). */
  aLaVenta: boolean;
  /** Si el stock vendible cubre la cantidad; `null` si ya no se vende. No informa cuántas hay. */
  stockSuficiente: boolean | null;
  /** Mientras sea `true`, el pedido no se puede crear: hay que quitarlo o ajustar la cantidad. */
  impideCrearPedido: boolean;
}

export interface CarritoCuenta {
  items: LineaCarrito[];
  /** Suma de los subtotales de las líneas que se venden, con IVA y en pesos. */
  total: number;
  /** Hay artículos y ninguno impide crear el pedido. */
  puedeCrearPedido: boolean;
}

/** Lo que se necesita de un artículo que la tienda vende a esa cuenta. */
interface ArticuloALaVenta {
  tipo: string;
  /** Precio neto guardado que le corresponde al rol: mayorista para el profesional. */
  neto: number;
  /** Los formatos que lo componen: él mismo si es formato, sus componentes si es pack. */
  componentes: { formatoId: number; cantidad: number }[];
}

const SELECCION_LINEA = {
  articuloId: true,
  cantidad: true,
  articulo: {
    select: {
      tipo: true,
      imagenes: IMAGEN_PRINCIPAL,
      formato: {
        select: {
          nombreFormato: true,
          producto: { select: { nombre: true } },
        },
      },
      pack: { select: { nombre: true } },
    },
  },
} satisfies Prisma.ItemCarritoSelect;

@Injectable()
export class CarritoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
  ) {}

  /**
   * E5-H1 · El carrito de la cuenta con sus totales a los precios vigentes. El carrito no guarda
   * precios (E5): se calculan al consultar, según el rol. Sin carrito responde vacío, sin crearlo.
   */
  async obtener(codigoPublico: string, rol: Rol): Promise<CarritoCuenta> {
    const carrito = await this.prisma.carrito.findFirst({
      where: { usuario: { codigoPublico } },
      select: {
        items: {
          select: SELECCION_LINEA,
          orderBy: [{ fechaAgregado: 'asc' }, { articuloId: 'asc' }],
        },
      },
    });
    return this.armar(this.prisma, carrito?.items ?? [], rol);
  }

  /**
   * E5-H1 · Suma unidades de un artículo al carrito (lo crea si hace falta). El artículo debe
   * venderse hoy a esta cuenta y el stock vendible debe cubrir la cantidad total resultante.
   */
  async agregar(
    codigoPublico: string,
    rol: Rol,
    dto: AgregarArticuloCarritoDto,
  ): Promise<CarritoCuenta> {
    await this.prisma.$transaction(async (tx) => {
      const usuarioId = await bloquearCuenta(tx, codigoPublico);
      const articulo = (
        await this.articulosALaVenta(tx, [dto.articuloId], rol)
      ).get(dto.articuloId);
      if (!articulo) {
        throw new BadRequestException(
          'El artículo no existe o no está a la venta.',
        );
      }
      const carrito = await tx.carrito.upsert({
        where: { usuarioId },
        create: { usuarioId },
        update: { fechaActualizacion: new Date() },
        select: { id: true },
      });
      const clave = {
        carritoId_articuloId: {
          carritoId: carrito.id,
          articuloId: dto.articuloId,
        },
      };
      const actual = await tx.itemCarrito.findUnique({
        where: clave,
        select: { cantidad: true },
      });
      const cantidad = (actual?.cantidad ?? 0) + dto.cantidad;
      if (cantidad > MAXIMO_UNIDADES_LINEA) {
        throw new BadRequestException(
          `Un artículo no puede superar las ${MAXIMO_UNIDADES_LINEA} unidades en el carrito.`,
        );
      }
      await this.exigirStock(tx, articulo, cantidad);
      await tx.itemCarrito.upsert({
        where: clave,
        create: {
          carritoId: carrito.id,
          articuloId: dto.articuloId,
          cantidad,
        },
        update: { cantidad },
      });
    });
    return this.obtener(codigoPublico, rol);
  }

  /** E5-H1 · Deja un artículo del carrito con esa cantidad. 404 si no está en el carrito. */
  async cambiarCantidad(
    codigoPublico: string,
    rol: Rol,
    articuloId: number,
    dto: CambiarCantidadCarritoDto,
  ): Promise<CarritoCuenta> {
    await this.prisma.$transaction(async (tx) => {
      const usuarioId = await bloquearCuenta(tx, codigoPublico);
      const carritoId = await this.exigirEnElCarrito(tx, usuarioId, articuloId);
      const articulo = (
        await this.articulosALaVenta(tx, [articuloId], rol)
      ).get(articuloId);
      if (!articulo) {
        throw new BadRequestException(
          'El artículo ya no está a la venta: quítalo del carrito.',
        );
      }
      await this.exigirStock(tx, articulo, dto.cantidad);
      await tx.itemCarrito.update({
        where: { carritoId_articuloId: { carritoId, articuloId } },
        data: { cantidad: dto.cantidad },
      });
      await tx.carrito.update({
        where: { id: carritoId },
        data: { fechaActualizacion: new Date() },
      });
    });
    return this.obtener(codigoPublico, rol);
  }

  /** E5-H1 · Quita un artículo del carrito, se venda o no. 404 si no está en el carrito. */
  async quitar(
    codigoPublico: string,
    rol: Rol,
    articuloId: number,
  ): Promise<CarritoCuenta> {
    await this.prisma.$transaction(async (tx) => {
      const usuarioId = await bloquearCuenta(tx, codigoPublico);
      const carritoId = await this.exigirEnElCarrito(tx, usuarioId, articuloId);
      await tx.itemCarrito.delete({
        where: { carritoId_articuloId: { carritoId, articuloId } },
      });
      await tx.carrito.update({
        where: { id: carritoId },
        data: { fechaActualizacion: new Date() },
      });
    });
    return this.obtener(codigoPublico, rol);
  }

  private async exigirEnElCarrito(
    tx: Cliente,
    usuarioId: number,
    articuloId: number,
  ): Promise<number> {
    const carrito = await tx.carrito.findUnique({
      where: { usuarioId },
      select: { id: true },
    });
    const item = carrito
      ? await tx.itemCarrito.findUnique({
          where: {
            carritoId_articuloId: { carritoId: carrito.id, articuloId },
          },
          select: { articuloId: true },
        })
      : null;
    if (!carrito || !item) throw new NotFoundException(NO_ESTA_EN_EL_CARRITO);
    return carrito.id;
  }

  /**
   * Los artículos de esa lista que la tienda vende hoy a ese rol, con la misma regla del listado
   * y del detalle (E2): formato o pack activo, con precio e imagen, de producto y marca activos,
   * pack vigente y con todos sus componentes a la venta. Solo el profesional compra productos
   * exclusivos y paga el mayorista; el mayorista nunca se lee para los demás (RNF-04).
   */
  private async articulosALaVenta(
    cliente: Cliente,
    ids: number[],
    rol: Rol,
  ): Promise<Map<number, ArticuloALaVenta>> {
    const vendibles = new Map<number, ArticuloALaVenta>();
    if (ids.length === 0) return vendibles;
    const verMayorista = rol === ROLES.PROFESIONAL;
    const hoy = hoyEnLaTienda();

    const formatos = verMayorista
      ? (
          await cliente.formatoProducto.findMany({
            where: {
              id: { in: ids },
              AND: [
                FORMATO_VENDIBLE_PROFESIONAL,
                { producto: productoALaVenta(true) },
              ],
            },
            select: {
              id: true,
              articulo: { select: { precioMayoristaNeto: true } },
            },
          })
        ).map(({ id, articulo }) => ({
          id,
          neto: Number(articulo.precioMayoristaNeto),
        }))
      : (
          await cliente.formatoProducto.findMany({
            where: {
              id: { in: ids },
              AND: [FORMATO_VENDIBLE, { producto: productoALaVenta(false) }],
            },
            select: {
              id: true,
              articulo: { select: { precioMinoristaNeto: true } },
            },
          })
        ).map(({ id, articulo }) => ({
          id,
          neto: Number(articulo.precioMinoristaNeto),
        }));
    for (const { id, neto } of formatos) {
      vendibles.set(id, {
        tipo: TIPOS_ARTICULO.FORMATO,
        neto,
        componentes: [{ formatoId: id, cantidad: 1 }],
      });
    }

    const componentes = {
      select: { formatoId: true, cantidad: true },
    } satisfies Prisma.Pack$componentesArgs;
    const packs = verMayorista
      ? (
          await cliente.pack.findMany({
            where: { id: { in: ids }, ...packsProfesional(hoy) },
            select: {
              id: true,
              componentes,
              articulo: { select: { precioMayoristaNeto: true } },
            },
          })
        ).map(({ id, componentes: lista, articulo }) => ({
          id,
          lista,
          neto: Number(articulo.precioMayoristaNeto),
        }))
      : (
          await cliente.pack.findMany({
            where: { id: { in: ids }, ...packsGenerales(hoy) },
            select: {
              id: true,
              componentes,
              articulo: { select: { precioMinoristaNeto: true } },
            },
          })
        ).map(({ id, componentes: lista, articulo }) => ({
          id,
          lista,
          neto: Number(articulo.precioMinoristaNeto),
        }));
    for (const { id, lista, neto } of packs) {
      vendibles.set(id, {
        tipo: TIPOS_ARTICULO.PACK,
        neto,
        componentes: lista,
      });
    }
    return vendibles;
  }

  /** Unidades del artículo que el stock vendible permite, por formato o por pack completo. */
  private unidadesPosibles(
    articulo: ArticuloALaVenta,
    stock: Map<number, number>,
  ): number {
    return articulo.tipo === TIPOS_ARTICULO.PACK
      ? unidadesDePack(articulo.componentes, stock)
      : unidadesDeFormato(stock, articulo.componentes[0].formatoId);
  }

  /** 400 si el stock vendible no cubre la cantidad. No dice cuántas unidades hay (E2-H3). */
  private async exigirStock(
    cliente: Cliente,
    articulo: ArticuloALaVenta,
    cantidad: number,
  ) {
    const stock = await stockVendible(
      cliente,
      articulo.componentes.map(({ formatoId }) => formatoId),
    );
    if (cantidad > this.unidadesPosibles(articulo, stock)) {
      throw new BadRequestException(
        'No hay stock suficiente para esa cantidad.',
      );
    }
  }

  /** Arma la respuesta: precio y stock de cada línea a la fecha de hoy y el total. */
  private async armar(
    cliente: Cliente,
    items: Prisma.ItemCarritoGetPayload<{ select: typeof SELECCION_LINEA }>[],
    rol: Rol,
  ): Promise<CarritoCuenta> {
    const porcentajeIva = this.config.get('IVA_PORCENTAJE', { infer: true });
    const urlBase = this.config.get('R2_URL_PUBLICA', { infer: true });
    const aLaVenta = await this.articulosALaVenta(
      cliente,
      items.map((item) => item.articuloId),
      rol,
    );
    const stock = await stockVendible(
      cliente,
      [...aLaVenta.values()].flatMap((articulo) =>
        articulo.componentes.map(({ formatoId }) => formatoId),
      ),
    );

    const lineas = items.map((item): LineaCarrito => {
      const { articulo } = item;
      const vendido = aLaVenta.get(item.articuloId);
      const precioUnitario = vendido
        ? precioConIva(vendido.neto, porcentajeIva)
        : null;
      const stockSuficiente = vendido
        ? item.cantidad <= this.unidadesPosibles(vendido, stock)
        : null;
      const clave = articulo.imagenes[0]?.ubicacionArchivo;
      return {
        articuloId: item.articuloId,
        tipo: articulo.tipo,
        nombre:
          articulo.formato?.producto.nombre ?? articulo.pack?.nombre ?? '',
        nombreFormato: articulo.formato?.nombreFormato ?? null,
        imagen: clave ? urlPublicaArchivo(urlBase, clave) : null,
        cantidad: item.cantidad,
        precioUnitario,
        subtotal:
          precioUnitario === null ? null : precioUnitario * item.cantidad,
        aLaVenta: vendido !== undefined,
        stockSuficiente,
        impideCrearPedido: stockSuficiente !== true,
      };
    });
    return {
      items: lineas,
      total: lineas.reduce((suma, linea) => suma + (linea.subtotal ?? 0), 0),
      puedeCrearPedido:
        lineas.length > 0 && lineas.every((linea) => !linea.impideCrearPedido),
    };
  }
}
