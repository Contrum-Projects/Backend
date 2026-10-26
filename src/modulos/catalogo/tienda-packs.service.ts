import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { urlPublicaArchivo } from '../../almacen/almacen-archivos.js';
import { deFechaSinHora, hoyEnLaTienda } from '../../common/dominio/fechas.js';
import { precioConIva } from '../../common/dominio/montos.js';
import { ROLES, type Rol } from '../../common/dominio/roles.js';
import { CANALES_VENTA } from '../../common/dominio/valores.js';
import {
  type Paginacion,
  POR_PAGINA,
} from '../../common/validacion/paginacion.js';
import type { Entorno } from '../../config/entorno.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { IMAGEN_PRINCIPAL } from './tienda.service.js';
import { packVigente } from './vigencia-pack.js';

/** Un componente se puede vender si su formato y su producto están activos y la marca también. */
const COMPONENTE_ACTIVO = {
  formato: {
    articulo: { activo: true },
    producto: {
      activo: true,
      OR: [{ marcaId: null }, { marca: { is: { activa: true } } }],
    },
  },
} satisfies Prisma.ComponentePackWhereInput;

/** En un pack general, además, ningún componente es de un producto exclusivo (RNF-04). */
const COMPONENTE_GENERAL = {
  formato: {
    ...COMPONENTE_ACTIVO.formato,
    producto: {
      ...COMPONENTE_ACTIVO.formato.producto,
      canalVenta: CANALES_VENTA.GENERAL,
    },
  },
} satisfies Prisma.ComponentePackWhereInput;

/**
 * Packs de la tienda para quien no es profesional (E3-H6): de venta general, vigentes hoy, con
 * el artículo activo, sus dos precios e imagen, y todos sus componentes a la venta.
 */
const packsGenerales = (hoy: string): Prisma.PackWhereInput => ({
  ...packVigente(hoy),
  canalVenta: CANALES_VENTA.GENERAL,
  articulo: {
    activo: true,
    precioMinoristaNeto: { not: null },
    precioMayoristaNeto: { not: null },
    imagenes: { some: {} },
  },
  componentes: { some: {}, every: COMPONENTE_GENERAL },
});

/**
 * Para el profesional, como en E2-H4: también los exclusivos, que solo necesitan el precio
 * mayorista; los generales siguen exigiendo los dos precios.
 */
const packsProfesional = (hoy: string): Prisma.PackWhereInput => ({
  AND: [
    packVigente(hoy),
    {
      OR: [
        {
          canalVenta: CANALES_VENTA.PROFESIONAL,
          componentes: { every: COMPONENTE_ACTIVO },
        },
        {
          canalVenta: CANALES_VENTA.GENERAL,
          articulo: { precioMinoristaNeto: { not: null } },
          componentes: { every: COMPONENTE_GENERAL },
        },
      ],
    },
  ],
  articulo: {
    activo: true,
    precioMayoristaNeto: { not: null },
    imagenes: { some: {} },
  },
  componentes: { some: {} },
});

const COMPONENTES = {
  select: {
    cantidad: true,
    formato: {
      select: { nombreFormato: true, producto: { select: { nombre: true } } },
    },
  },
  orderBy: { formatoId: 'asc' },
} satisfies Prisma.Pack$componentesArgs;

/** Lo que ve quien no es profesional. El `select` es explícito: no lee el mayorista (RNF-04). */
const SELECCION = {
  id: true,
  nombre: true,
  descripcion: true,
  fechaFinVigencia: true,
  articulo: {
    select: { precioMinoristaNeto: true, imagenes: IMAGEN_PRINCIPAL },
  },
  componentes: COMPONENTES,
} satisfies Prisma.PackSelect;

const SELECCION_PROFESIONAL = {
  ...SELECCION,
  canalVenta: true,
  articulo: {
    select: {
      precioMinoristaNeto: true,
      precioMayoristaNeto: true,
      imagenes: IMAGEN_PRINCIPAL,
    },
  },
} satisfies Prisma.PackSelect;

const ORDEN = [
  { nombre: 'asc' },
  { id: 'asc' },
] satisfies Prisma.PackOrderByWithRelationInput[];

type FilaPack = Prisma.PackGetPayload<{ select: typeof SELECCION }>;
type FilaPackProfesional = Prisma.PackGetPayload<{
  select: typeof SELECCION_PROFESIONAL;
}>;

export interface ComponentePackTienda {
  producto: string;
  formato: string;
  cantidad: number;
}

export interface PackTienda {
  id: number;
  nombre: string;
  descripcion: string;
  /** Precio minorista con IVA incluido, en pesos enteros. */
  precio: number;
  /** URL pública de la imagen principal del pack. */
  imagen: string;
  /** Último día de la promoción (AAAA-MM-DD), o `null` si no tiene término. */
  vigenteHasta: string | null;
  componentes: ComponentePackTienda[];
}

/** Lo que ve el profesional: el mayorista y si el pack es exclusivo (como en E2-H4). */
export interface PackTiendaProfesional extends Omit<PackTienda, 'precio'> {
  /** Precio minorista con IVA; `null` si el pack es exclusivo para profesionales. */
  precio: number | null;
  /** Precio mayorista con IVA incluido, en pesos enteros. */
  precioMayorista: number;
  exclusivo: boolean;
}

export interface ListadoPacksTienda {
  items: (PackTienda | PackTiendaProfesional)[];
  total: number;
  pagina: number;
  limite: number;
}

@Injectable()
export class TiendaPacksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
  ) {}

  /**
   * Packs de la tienda (E3-H6), ordenados por nombre. Un pack fuera de su vigencia (hora de
   * Chile) no se devuelve (criterio 3). Solo el `rol` profesional ve los exclusivos y el
   * mayorista (RNF-04). Sin caché: lleva precios.
   */
  async listar(paginacion: Paginacion, rol?: Rol): Promise<ListadoPacksTienda> {
    const pagina = paginacion.pagina ?? 1;
    const limite = paginacion.limite ?? POR_PAGINA;
    const hoy = hoyEnLaTienda();
    const porcentajeIva = this.config.get('IVA_PORCENTAJE', { infer: true });
    const urlBase = this.config.get('R2_URL_PUBLICA', { infer: true });
    const pedido = {
      orderBy: ORDEN,
      skip: (pagina - 1) * limite,
      take: limite,
    };
    if (rol === ROLES.PROFESIONAL) {
      const where = packsProfesional(hoy);
      const [filas, total] = await this.prisma.$transaction([
        this.prisma.pack.findMany({
          ...pedido,
          where,
          select: SELECCION_PROFESIONAL,
        }),
        this.prisma.pack.count({ where }),
      ]);
      const items = filas.map((fila) =>
        aPackProfesional(fila, porcentajeIva, urlBase),
      );
      return { items, total, pagina, limite };
    }
    const where = packsGenerales(hoy);
    const [filas, total] = await this.prisma.$transaction([
      this.prisma.pack.findMany({ ...pedido, where, select: SELECCION }),
      this.prisma.pack.count({ where }),
    ]);
    const items = filas.map((fila) =>
      aPackTienda(fila, porcentajeIva, urlBase),
    );
    return { items, total, pagina, limite };
  }
}

/** Datos del pack que ven todos. El filtro de la consulta asegura que tiene imagen. */
const datosComunes = (
  fila: FilaPack | FilaPackProfesional,
  urlBase: string | undefined,
) => ({
  id: fila.id,
  nombre: fila.nombre,
  descripcion: fila.descripcion,
  imagen: urlPublicaArchivo(
    urlBase,
    fila.articulo.imagenes[0]!.ubicacionArchivo,
  ),
  vigenteHasta: deFechaSinHora(fila.fechaFinVigencia),
  componentes: fila.componentes.map(({ cantidad, formato }) => ({
    producto: formato.producto.nombre,
    formato: formato.nombreFormato,
    cantidad,
  })),
});

const aPackTienda = (
  fila: FilaPack,
  porcentajeIva: number,
  urlBase: string | undefined,
): PackTienda => ({
  ...datosComunes(fila, urlBase),
  precio: precioConIva(
    Number(fila.articulo.precioMinoristaNeto),
    porcentajeIva,
  ),
});

/** Un exclusivo no muestra el minorista aunque lo tenga guardado (E3-H5). */
const aPackProfesional = (
  fila: FilaPackProfesional,
  porcentajeIva: number,
  urlBase: string | undefined,
): PackTiendaProfesional => {
  const exclusivo = fila.canalVenta === CANALES_VENTA.PROFESIONAL;
  const { precioMinoristaNeto, precioMayoristaNeto } = fila.articulo;
  return {
    ...datosComunes(fila, urlBase),
    precio:
      exclusivo || precioMinoristaNeto === null
        ? null
        : precioConIva(Number(precioMinoristaNeto), porcentajeIva),
    precioMayorista: precioConIva(Number(precioMayoristaNeto), porcentajeIva),
    exclusivo,
  };
};
