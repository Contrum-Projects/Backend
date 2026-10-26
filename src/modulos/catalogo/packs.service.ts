import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  aFechaSinHora,
  deFechaSinHora,
  hoyEnLaTienda,
} from '../../common/dominio/fechas.js';
import { CANALES_VENTA, TIPOS_ARTICULO } from '../../common/dominio/valores.js';
import {
  type Paginacion,
  POR_PAGINA,
} from '../../common/validacion/paginacion.js';
import type { Entorno } from '../../config/entorno.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  bloquearArticulo,
  bloquearPack,
  bloquearProductosDeFormatos,
} from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ActualizarPackDto } from './dto/actualizar-pack.dto.js';
import type { CrearPackDto } from './dto/crear-pack.dto.js';
import {
  aImagenPanel,
  type ImagenPanel,
  ORDEN_IMAGENES,
  SELECCION_IMAGEN,
} from './imagenes.service.js';
import { estaVigente } from './vigencia-pack.js';

const NO_EXISTE = 'El pack no existe.';

/**
 * Lo que el panel ve de un pack: sus datos, su vigencia, sus componentes y las imágenes de su
 * artículo. Los precios no van aquí: son de E3-H5 (`GET /catalogo/articulos/:id/precios`).
 */
const SELECCION = {
  id: true,
  nombre: true,
  descripcion: true,
  canalVenta: true,
  fechaInicioVigencia: true,
  fechaFinVigencia: true,
  fechaCreacion: true,
  articulo: {
    select: {
      sku: true,
      activo: true,
      imagenes: { select: SELECCION_IMAGEN, orderBy: ORDEN_IMAGENES },
    },
  },
  componentes: {
    select: {
      cantidad: true,
      formato: {
        select: {
          id: true,
          nombreFormato: true,
          articulo: { select: { sku: true } },
          producto: { select: { id: true, nombre: true } },
        },
      },
    },
    orderBy: { formatoId: 'asc' },
  },
} satisfies Prisma.PackSelect;

type FilaPack = Prisma.PackGetPayload<{ select: typeof SELECCION }>;

export interface ComponentePackPanel {
  formatoId: number;
  sku: string;
  nombreFormato: string;
  producto: { id: number; nombre: string };
  cantidad: number;
}

/** Pack tal como lo devuelve el panel; las fechas de vigencia en AAAA-MM-DD. */
export interface PackPanel {
  id: number;
  sku: string;
  nombre: string;
  descripcion: string;
  canalVenta: string;
  fechaInicioVigencia: string | null;
  fechaFinVigencia: string | null;
  /** Si hoy (hora de Chile) está dentro de la vigencia. */
  vigente: boolean;
  activo: boolean;
  fechaCreacion: Date;
  componentes: ComponentePackPanel[];
  imagenes: ImagenPanel[];
}

export interface ListadoPacks {
  items: PackPanel[];
  total: number;
  pagina: number;
  limite: number;
}

interface Componente {
  formatoId: number;
  cantidad: number;
}

type Tx = Prisma.TransactionClient;

/** El término de la vigencia no puede ser anterior al inicio (AAAA-MM-DD se compara como texto). */
const exigirVigencia = (inicio: string | null, fin: string | null) => {
  if (inicio !== null && fin !== null && fin < inicio) {
    throw new BadRequestException(
      'La fecha de término de la vigencia no puede ser anterior a la de inicio.',
    );
  }
};

@Injectable()
export class PacksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
  ) {}

  /** Packs del panel, ordenados por nombre, con su vigencia de hoy. */
  async listar(paginacion: Paginacion): Promise<ListadoPacks> {
    const pagina = paginacion.pagina ?? 1;
    const limite = paginacion.limite ?? POR_PAGINA;
    const [filas, total] = await this.prisma.$transaction([
      this.prisma.pack.findMany({
        select: SELECCION,
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
        skip: (pagina - 1) * limite,
        take: limite,
      }),
      this.prisma.pack.count(),
    ]);
    const hoy = hoyEnLaTienda();
    return {
      items: filas.map((fila) => this.aRespuesta(fila, hoy)),
      total,
      pagina,
      limite,
    };
  }

  async obtener(id: number): Promise<PackPanel> {
    const fila = await this.prisma.pack.findUnique({
      where: { id },
      select: SELECCION,
    });
    if (!fila) {
      throw new NotFoundException(NO_EXISTE);
    }
    return this.aRespuesta(fila, hoyEnLaTienda());
  }

  /**
   * Crea un pack (E3-H6, RF-03.09): su artículo de venta de tipo pack (sin precios, que fija
   * E3-H5) y sus componentes, en una transacción. No tiene stock propio: no se crea ninguna
   * existencia. Los componentes deben ser formatos de producto activos (otro pack se rechaza) y,
   * si el pack es de venta general, de productos generales.
   */
  async crear(dto: CrearPackDto): Promise<PackPanel> {
    const inicio = dto.fechaInicioVigencia ?? null;
    const fin = dto.fechaFinVigencia ?? null;
    exigirVigencia(inicio, fin);
    try {
      const fila = await this.prisma.$transaction(async (tx) => {
        await exigirSkuLibre(tx, dto.sku);
        await exigirComponentes(tx, dto.canalVenta, dto.componentes);
        const articulo = await tx.articuloVenta.create({
          data: { sku: dto.sku, tipo: TIPOS_ARTICULO.PACK },
          select: { id: true },
        });
        return tx.pack.create({
          data: {
            id: articulo.id,
            nombre: dto.nombre,
            descripcion: dto.descripcion,
            canalVenta: dto.canalVenta,
            fechaInicioVigencia: aFechaSinHora(inicio),
            fechaFinVigencia: aFechaSinHora(fin),
            componentes: { create: dto.componentes.map(aComponente) },
          },
          select: SELECCION,
        });
      });
      return this.aRespuesta(fila, hoyEnLaTienda());
    } catch (error) {
      await this.explicarChoque(error, dto.sku);
      throw error;
    }
  }

  /**
   * Cambia un pack (E3-H6). Solo se modifica lo que llega; `componentes` reemplaza la lista
   * completa. Si cambian el canal o los componentes se revisan otra vez las reglas de los
   * componentes con el canal y los componentes que quedarán. La fila del pack queda bloqueada,
   * así su canal no cambia mientras se fijan precios (E3-H5).
   */
  async actualizar(id: number, dto: ActualizarPackDto): Promise<PackPanel> {
    if (Object.values(dto).every((valor) => valor === undefined)) {
      throw new BadRequestException('Indica al menos un campo para cambiar.');
    }
    try {
      const fila = await this.prisma.$transaction(async (tx) => {
        // Mismo orden que al fijar precios (E3-H5): artículo y luego pack
        await bloquearArticulo(tx, id, NO_EXISTE);
        await bloquearPack(tx, id, NO_EXISTE);
        const actual = await tx.pack.findUnique({
          where: { id },
          select: {
            canalVenta: true,
            fechaInicioVigencia: true,
            fechaFinVigencia: true,
            componentes: { select: { formatoId: true, cantidad: true } },
          },
        });
        if (!actual) {
          throw new NotFoundException(NO_EXISTE);
        }
        exigirVigencia(
          dto.fechaInicioVigencia !== undefined
            ? dto.fechaInicioVigencia
            : deFechaSinHora(actual.fechaInicioVigencia),
          dto.fechaFinVigencia !== undefined
            ? dto.fechaFinVigencia
            : deFechaSinHora(actual.fechaFinVigencia),
        );
        if (dto.canalVenta !== undefined || dto.componentes !== undefined) {
          await exigirComponentes(
            tx,
            dto.canalVenta ?? actual.canalVenta,
            dto.componentes ?? actual.componentes,
          );
        }
        if (dto.sku !== undefined) {
          await exigirSkuLibre(tx, dto.sku, id);
          await tx.articuloVenta.update({
            where: { id },
            data: { sku: dto.sku },
          });
        }
        if (dto.componentes !== undefined) {
          await tx.componentePack.deleteMany({ where: { packId: id } });
        }
        return tx.pack.update({
          where: { id },
          data: {
            nombre: dto.nombre,
            descripcion: dto.descripcion,
            canalVenta: dto.canalVenta,
            fechaInicioVigencia: aFechaSinHora(dto.fechaInicioVigencia),
            fechaFinVigencia: aFechaSinHora(dto.fechaFinVigencia),
            componentes: dto.componentes
              ? { create: dto.componentes.map(aComponente) }
              : undefined,
          },
          select: SELECCION,
        });
      });
      return this.aRespuesta(fila, hoyEnLaTienda());
    } catch (error) {
      await this.explicarChoque(error, dto.sku, id);
      throw error;
    }
  }

  private aRespuesta(fila: FilaPack, hoy: string): PackPanel {
    const urlBaseImagenes = this.config.get('R2_URL_PUBLICA', { infer: true });
    const inicio = deFechaSinHora(fila.fechaInicioVigencia);
    const fin = deFechaSinHora(fila.fechaFinVigencia);
    return {
      id: fila.id,
      sku: fila.articulo.sku,
      nombre: fila.nombre,
      descripcion: fila.descripcion,
      canalVenta: fila.canalVenta,
      fechaInicioVigencia: inicio,
      fechaFinVigencia: fin,
      vigente: estaVigente(inicio, fin, hoy),
      activo: fila.articulo.activo,
      fechaCreacion: fila.fechaCreacion,
      componentes: fila.componentes.map(({ cantidad, formato }) => ({
        formatoId: formato.id,
        sku: formato.articulo.sku,
        nombreFormato: formato.nombreFormato,
        producto: formato.producto,
        cantidad,
      })),
      imagenes: fila.articulo.imagenes.map((imagen) =>
        aImagenPanel(imagen, urlBaseImagenes),
      ),
    };
  }

  /**
   * Dos guardados simultáneos con el mismo SKU: gana el primero y al segundo la base le
   * responde P2002, que se informa como el 409 de siempre.
   */
  private async explicarChoque(
    error: unknown,
    sku: string | undefined,
    excluirId?: number,
  ) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return;
    }
    // Solo el SKU tiene un índice único que el personal puede repetir; otro choque se relanza
    if (sku === undefined) {
      return;
    }
    await exigirSkuLibre(this.prisma, sku, excluirId);
    throw new ConflictException('El SKU ya pertenece a otro artículo.');
  }
}

const aComponente = ({ formatoId, cantidad }: Componente) => ({
  formatoId,
  cantidad,
});

/** El SKU es único entre todos los artículos, formatos y packs (E3-H2): 409 si está tomado. */
const exigirSkuLibre = async (
  cliente: Tx | PrismaService,
  sku: string,
  excluirId?: number,
) => {
  const ocupado = await cliente.articuloVenta.findFirst({
    where: {
      sku,
      id: excluirId === undefined ? undefined : { not: excluirId },
    },
    select: { id: true },
  });
  if (ocupado) {
    throw new ConflictException('El SKU ya pertenece a otro artículo.');
  }
};

/**
 * Reglas de los componentes (criterio 2 de E3-H6): cada id debe ser un formato de producto (otro
 * pack se rechaza), existir y estar activo con su producto. Un pack de venta general no lleva
 * formatos de productos exclusivos, que no se venden a minoristas (RNF-04).
 */
const exigirComponentes = async (
  tx: Tx,
  canalVenta: string,
  componentes: Componente[],
) => {
  const ids = componentes.map((componente) => componente.formatoId);
  // El canal y el estado de los productos no cambian hasta el commit del pack
  await bloquearProductosDeFormatos(tx, ids);
  const articulos = await tx.articuloVenta.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      tipo: true,
      activo: true,
      formato: {
        select: { producto: { select: { activo: true, canalVenta: true } } },
      },
    },
  });
  if (articulos.some((articulo) => articulo.tipo === TIPOS_ARTICULO.PACK)) {
    throw new BadRequestException(
      'Un pack solo admite formatos de producto como componentes, no otros packs.',
    );
  }
  const porId = new Map(articulos.map((articulo) => [articulo.id, articulo]));
  for (const id of ids) {
    const articulo = porId.get(id);
    if (!articulo?.formato) {
      throw new BadRequestException(`El formato con id ${id} no existe.`);
    }
    if (!articulo.activo || !articulo.formato.producto.activo) {
      throw new BadRequestException(
        `El formato con id ${id} no está activo o su producto fue desactivado.`,
      );
    }
    if (
      canalVenta === CANALES_VENTA.GENERAL &&
      articulo.formato.producto.canalVenta === CANALES_VENTA.PROFESIONAL
    ) {
      throw new BadRequestException(
        `Un pack de venta general no puede llevar el formato con id ${id}: su producto es exclusivo para profesionales.`,
      );
    }
  }
};
