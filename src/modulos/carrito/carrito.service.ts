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
import {
  AJUSTES_UNION_CARRITO,
  TIPOS_ARTICULO,
  type Valor,
} from '../../common/dominio/valores.js';
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
import type { ArticuloNavegadorDto } from './dto/articulos-navegador.dto.js';

const NO_ESTA_EN_EL_CARRITO = 'El artículo no está en el carrito.';

type Cliente = Prisma.TransactionClient | PrismaService;

/**
 * Quién compra: un rol comprador con sesión, o `null` para el visitante (E5-H2), que ve lo mismo
 * que el cliente: precio minorista y solo artículos generales.
 */
type Comprador = Rol | null;

/** Un artículo de la tienda en el carrito, con su precio y sus existencias (E5-H1). */
export interface LineaCarrito {
  articuloId: number;
  /**
   * `formato` o `pack` (`TIPOS_ARTICULO`); `null` al cotizar sin cuenta un artículo que no se
   * vende, para no revelar si existe (E5-H2).
   */
  tipo: string | null;
  /** Nombre del producto, o del pack; vacío en lo mismo que `tipo` en `null`. */
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
  /** E5-H4 · Solo el profesional: un formato con menos unidades que el mínimo. */
  bajoMinimo: boolean;
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

/** Un artículo del navegador que no se unió entero al carrito de la cuenta (E5-H2). */
export interface AjusteUnionCarrito {
  articuloId: number;
  /** `AJUSTES_UNION_CARRITO`; no informa cuántas unidades hay. */
  motivo: Valor<typeof AJUSTES_UNION_CARRITO>;
}

export interface CarritoUnido extends CarritoCuenta {
  /** Lo que se descartó o se ajustó al unir; vacío si todo entró tal cual. */
  ajustes: AjusteUnionCarrito[];
}

/** Lo que se necesita de un artículo que la tienda vende a esa cuenta. */
export interface ArticuloALaVenta {
  tipo: string;
  /** Precio neto guardado que le corresponde al rol: mayorista para el profesional. */
  neto: number;
  /** Los formatos que lo componen: él mismo si es formato, sus componentes si es pack. */
  componentes: { formatoId: number; cantidad: number }[];
}

/**
 * E5-H4 · Si una línea no alcanza el mínimo del profesional. Solo se exige a los formatos: un pack
 * no tiene mínimo y sus componentes no suman a los formatos sueltos.
 */
export const bajoMinimoProfesional = (
  comprador: Comprador,
  tipo: string,
  cantidad: number,
  minimo: number,
): boolean =>
  comprador === ROLES.PROFESIONAL &&
  tipo === TIPOS_ARTICULO.FORMATO &&
  cantidad < minimo;

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

type DatosArticulo = Prisma.ArticuloVentaGetPayload<{
  select: typeof SELECCION_LINEA.articulo.select;
}>;

/** Una línea por armar: los datos del artículo faltan si no se deben mostrar. */
interface LineaPorArmar {
  articuloId: number;
  cantidad: number;
  articulo: DatosArticulo | null;
}

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

  /**
   * E5-H2 · Precios y disponibilidad vigentes del carrito que el visitante guarda en su navegador,
   * sin cuenta: precio minorista y solo artículos generales. No escribe nada en la base. Un
   * artículo que no se vende sale sin datos, para no revelar si existe ni si es exclusivo.
   */
  async cotizar(articulos: ArticuloNavegadorDto[]): Promise<CarritoCuenta> {
    const ids = articulos.map(({ articuloId }) => articuloId);
    const aLaVenta = await this.articulosALaVenta(this.prisma, ids, null);
    const datos = await this.prisma.articuloVenta.findMany({
      where: { id: { in: [...aLaVenta.keys()] } },
      select: { id: true, ...SELECCION_LINEA.articulo.select },
    });
    const datosPorId = new Map(datos.map(({ id, ...resto }) => [id, resto]));
    return this.armar(
      this.prisma,
      articulos.map(({ articuloId, cantidad }) => ({
        articuloId,
        cantidad,
        articulo: datosPorId.get(articuloId) ?? null,
      })),
      null,
      aLaVenta,
    );
  }

  /**
   * E5-H2 · Une el carrito del navegador al de la cuenta (lo crea si hace falta). Un artículo que
   * ya estaba suma sus unidades. Lo que la tienda no vende a esta cuenta o está agotado se
   * descarta, y una suma que pasa del tope por artículo queda en el tope; cada caso va en
   * `ajustes`. La cantidad **no** se recorta al stock: devolverla recortada diría cuántas unidades
   * hay (E2-H3). La línea queda marcada como en `obtener` hasta que se ajuste.
   */
  async unir(
    codigoPublico: string,
    rol: Rol,
    articulos: ArticuloNavegadorDto[],
  ): Promise<CarritoUnido> {
    const ajustes: AjusteUnionCarrito[] = [];
    await this.prisma.$transaction(async (tx) => {
      const usuarioId = await bloquearCuenta(tx, codigoPublico);
      const ids = articulos.map(({ articuloId }) => articuloId);
      const aLaVenta = await this.articulosALaVenta(tx, ids, rol);
      const stock = await stockVendible(
        tx,
        [...aLaVenta.values()].flatMap((articulo) =>
          articulo.componentes.map(({ formatoId }) => formatoId),
        ),
      );
      const guardado = await tx.carrito.findUnique({
        where: { usuarioId },
        select: {
          items: {
            where: { articuloId: { in: ids } },
            select: { articuloId: true, cantidad: true },
          },
        },
      });
      const previas = new Map(
        (guardado?.items ?? []).map((item) => [item.articuloId, item.cantidad]),
      );

      const nuevas = new Map<number, number>();
      for (const { articuloId, cantidad } of articulos) {
        const vendido = aLaVenta.get(articuloId);
        if (!vendido) {
          ajustes.push({
            articuloId,
            motivo: AJUSTES_UNION_CARRITO.NO_DISPONIBLE,
          });
          continue;
        }
        if (this.unidadesPosibles(vendido, stock) === 0) {
          ajustes.push({ articuloId, motivo: AJUSTES_UNION_CARRITO.AGOTADO });
          continue;
        }
        const previa = previas.get(articuloId) ?? 0;
        const deseada = previa + cantidad;
        if (deseada > MAXIMO_UNIDADES_LINEA) {
          ajustes.push({
            articuloId,
            motivo: AJUSTES_UNION_CARRITO.CANTIDAD_AJUSTADA,
          });
        }
        if (previa < MAXIMO_UNIDADES_LINEA) {
          nuevas.set(articuloId, Math.min(deseada, MAXIMO_UNIDADES_LINEA));
        }
      }
      if (nuevas.size === 0) return;

      const carrito = await tx.carrito.upsert({
        where: { usuarioId },
        create: { usuarioId },
        update: { fechaActualizacion: new Date() },
        select: { id: true },
      });
      for (const [articuloId, cantidad] of nuevas) {
        await tx.itemCarrito.upsert({
          where: {
            carritoId_articuloId: { carritoId: carrito.id, articuloId },
          },
          create: { carritoId: carrito.id, articuloId, cantidad },
          update: { cantidad },
        });
      }
    });
    return { ...(await this.obtener(codigoPublico, rol)), ajustes };
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
  async articulosALaVenta(
    cliente: Cliente,
    ids: number[],
    rol: Comprador,
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

  /**
   * Arma la respuesta: precio y stock de cada línea a la fecha de hoy y el total. Recibe los
   * artículos a la venta si quien llama ya los consultó.
   */
  private async armar(
    cliente: Cliente,
    items: LineaPorArmar[],
    rol: Comprador,
    vendibles?: Map<number, ArticuloALaVenta>,
  ): Promise<CarritoCuenta> {
    const porcentajeIva = this.config.get('IVA_PORCENTAJE', { infer: true });
    const urlBase = this.config.get('R2_URL_PUBLICA', { infer: true });
    const minimo = this.config.get('MINIMO_UNIDADES_PELUQUERO', {
      infer: true,
    });
    const aLaVenta =
      vendibles ??
      (await this.articulosALaVenta(
        cliente,
        items.map((item) => item.articuloId),
        rol,
      ));
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
      const bajoMinimo = vendido
        ? bajoMinimoProfesional(rol, vendido.tipo, item.cantidad, minimo)
        : false;
      const clave = articulo?.imagenes[0]?.ubicacionArchivo;
      return {
        articuloId: item.articuloId,
        tipo: articulo?.tipo ?? null,
        nombre:
          articulo?.formato?.producto.nombre ?? articulo?.pack?.nombre ?? '',
        nombreFormato: articulo?.formato?.nombreFormato ?? null,
        imagen: clave ? urlPublicaArchivo(urlBase, clave) : null,
        cantidad: item.cantidad,
        precioUnitario,
        subtotal:
          precioUnitario === null ? null : precioUnitario * item.cantidad,
        aLaVenta: vendido !== undefined,
        stockSuficiente,
        bajoMinimo,
        impideCrearPedido: stockSuficiente !== true || bajoMinimo,
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
