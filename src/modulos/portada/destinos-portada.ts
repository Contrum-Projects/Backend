import { Injectable } from '@nestjs/common';
import { hoyEnLaTienda } from '../../common/dominio/fechas.js';
import {
  PAGINAS_PORTADA,
  TIPOS_DESTINO_PORTADA,
  type Valor,
} from '../../common/dominio/valores.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { packsGenerales } from '../catalogo/tienda-packs.service.js';
import { productoALaVenta } from '../catalogo/tienda.service.js';

export type TipoDestinoPortada = Valor<typeof TIPOS_DESTINO_PORTADA>;
export type PaginaPortada = Valor<typeof PAGINAS_PORTADA>;

/** Nombre con que se anuncia cada página de la tienda (texto del enlace del slide). */
export const NOMBRES_PAGINAS: Readonly<Record<PaginaPortada, string>> = {
  [PAGINAS_PORTADA.CATALOGO]: 'Catálogo',
  [PAGINAS_PORTADA.PACKS]: 'Packs',
  [PAGINAS_PORTADA.PRECIO_PROFESIONAL]: 'Precio profesional',
};

const PAGINAS = Object.values(PAGINAS_PORTADA) as string[];

/** Lo que se sabe de un destino: su nombre (si todavía existe) y si la tienda lo muestra. */
export interface DestinoResuelto {
  nombre: string | null;
  disponible: boolean;
}

/** Una opción para elegir el destino en el panel. */
export interface OpcionDestino {
  destino: string;
  nombre: string;
}

/** Destinos que se resuelven juntos, para no consultar la base una vez por slide. */
interface DestinoPedido {
  tipoDestino: string;
  destino: string;
}

/** Clave con que `resolver` entrega cada destino. */
export const claveDestino = (tipo: string, destino: string) =>
  `${tipo}:${destino}`;

/** El id de un destino del catálogo, o `null` si no es un entero positivo. */
export const idDeDestino = (destino: string): number | null => {
  if (!/^[1-9]\d{0,9}$/.test(destino)) return null;
  const id = Number(destino);
  return id <= 2_147_483_647 ? id : null;
};

const MAXIMO_OPCIONES = 20;

/**
 * Resuelve los destinos de los slides de la portada (SCRUM-157). Un destino está disponible si
 * cualquier visitante lo ve en la tienda: el producto y el pack con la misma regla del catálogo
 * público (de venta general, activos, con precios e imagen; el pack, vigente hoy), la marca
 * activa y la categoría existente. La portada es pública: nunca enlaza a un exclusivo (RNF-04).
 */
@Injectable()
export class DestinosPortada {
  constructor(private readonly prisma: PrismaService) {}

  /** Nombre y disponibilidad de cada destino, con la clave `tipo:destino`. */
  async resolver(
    pedidos: DestinoPedido[],
  ): Promise<Map<string, DestinoResuelto>> {
    const ids = (tipo: TipoDestinoPortada) => [
      ...new Set(
        pedidos
          .filter((pedido) => pedido.tipoDestino === tipo)
          .map((pedido) => idDeDestino(pedido.destino))
          .filter((id): id is number => id !== null),
      ),
    ];
    const productos = ids(TIPOS_DESTINO_PORTADA.PRODUCTO);
    const packs = ids(TIPOS_DESTINO_PORTADA.PACK);
    const categorias = ids(TIPOS_DESTINO_PORTADA.CATEGORIA);
    const marcas = ids(TIPOS_DESTINO_PORTADA.MARCA);
    const hoy = hoyEnLaTienda();
    const ninguno = Promise.resolve([] as { id: number; nombre: string }[]);

    const [
      todosProductos,
      productosALaVenta,
      todosPacks,
      packsALaVenta,
      filasCategorias,
      filasMarcas,
    ] = await Promise.all([
      productos.length
        ? this.prisma.producto.findMany({
            where: { id: { in: productos } },
            select: { id: true, nombre: true },
          })
        : ninguno,
      productos.length
        ? this.prisma.producto.findMany({
            where: { id: { in: productos }, ...productoALaVenta(false) },
            select: { id: true, nombre: true },
          })
        : ninguno,
      packs.length
        ? this.prisma.pack.findMany({
            where: { id: { in: packs } },
            select: { id: true, nombre: true },
          })
        : ninguno,
      packs.length
        ? this.prisma.pack.findMany({
            where: { id: { in: packs }, ...packsGenerales(hoy) },
            select: { id: true, nombre: true },
          })
        : ninguno,
      categorias.length
        ? this.prisma.categoria.findMany({
            where: { id: { in: categorias } },
            select: { id: true, nombre: true },
          })
        : ninguno,
      marcas.length
        ? this.prisma.marca.findMany({
            where: { id: { in: marcas } },
            select: { id: true, nombre: true, activa: true },
          })
        : Promise.resolve(
            [] as { id: number; nombre: string; activa: boolean }[],
          ),
    ]);

    const resultado = new Map<string, DestinoResuelto>();
    const anotar = (
      tipo: TipoDestinoPortada,
      filas: { id: number; nombre: string }[],
      disponibles: Set<number>,
    ) => {
      for (const fila of filas) {
        resultado.set(claveDestino(tipo, String(fila.id)), {
          nombre: fila.nombre,
          disponible: disponibles.has(fila.id),
        });
      }
    };
    anotar(
      TIPOS_DESTINO_PORTADA.PRODUCTO,
      todosProductos,
      new Set(productosALaVenta.map((fila) => fila.id)),
    );
    anotar(
      TIPOS_DESTINO_PORTADA.PACK,
      todosPacks,
      new Set(packsALaVenta.map((fila) => fila.id)),
    );
    anotar(
      TIPOS_DESTINO_PORTADA.CATEGORIA,
      filasCategorias,
      new Set(filasCategorias.map((fila) => fila.id)),
    );
    anotar(
      TIPOS_DESTINO_PORTADA.MARCA,
      filasMarcas,
      new Set(filasMarcas.filter((fila) => fila.activa).map((fila) => fila.id)),
    );
    for (const pedido of pedidos) {
      if (
        pedido.tipoDestino === TIPOS_DESTINO_PORTADA.PAGINA &&
        PAGINAS.includes(pedido.destino)
      ) {
        resultado.set(claveDestino(pedido.tipoDestino, pedido.destino), {
          nombre: NOMBRES_PAGINAS[pedido.destino as PaginaPortada],
          disponible: true,
        });
      }
    }
    return resultado;
  }

  /** Un solo destino; uno que no existe queda sin nombre y no disponible. */
  async resolverUno(
    tipoDestino: string,
    destino: string,
  ): Promise<DestinoResuelto> {
    const resultado = await this.resolver([{ tipoDestino, destino }]);
    return (
      resultado.get(claveDestino(tipoDestino, destino)) ?? {
        nombre: null,
        disponible: false,
      }
    );
  }

  /**
   * Destinos que se pueden elegir de un tipo, solo los disponibles, por nombre. `buscar` filtra
   * por nombre sin distinguir mayúsculas; las páginas se listan siempre todas.
   */
  async opciones(
    tipo: TipoDestinoPortada,
    buscar?: string,
  ): Promise<OpcionDestino[]> {
    const nombre = buscar
      ? { contains: buscar, mode: 'insensitive' as const }
      : undefined;
    const comun = {
      orderBy: { nombre: 'asc' as const },
      take: MAXIMO_OPCIONES,
      select: { id: true, nombre: true },
    };
    let filas: { id: number; nombre: string }[];
    switch (tipo) {
      case TIPOS_DESTINO_PORTADA.PAGINA:
        return Object.values(PAGINAS_PORTADA).map((pagina) => ({
          destino: pagina,
          nombre: NOMBRES_PAGINAS[pagina],
        }));
      case TIPOS_DESTINO_PORTADA.PRODUCTO:
        filas = await this.prisma.producto.findMany({
          ...comun,
          where: { ...productoALaVenta(false), nombre },
        });
        break;
      case TIPOS_DESTINO_PORTADA.PACK:
        filas = await this.prisma.pack.findMany({
          ...comun,
          where: { ...packsGenerales(hoyEnLaTienda()), nombre },
        });
        break;
      case TIPOS_DESTINO_PORTADA.CATEGORIA:
        filas = await this.prisma.categoria.findMany({
          ...comun,
          where: { nombre },
        });
        break;
      case TIPOS_DESTINO_PORTADA.MARCA:
        filas = await this.prisma.marca.findMany({
          ...comun,
          where: { activa: true, nombre },
        });
        break;
    }
    return filas.map((fila) => ({
      destino: String(fila.id),
      nombre: fila.nombre,
    }));
  }
}
