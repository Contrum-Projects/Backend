import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TIPOS_ARTICULO } from '../../common/dominio/valores.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { Entorno } from '../../config/entorno.js';
import {
  bloquearFormatosDelProducto,
  bloquearProducto,
  bloquearProductoDelFormato,
} from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ActualizarFormatoDto } from './dto/actualizar-formato.dto.js';
import type { CrearFormatoDto } from './dto/crear-formato.dto.js';
import {
  aImagenPanel,
  type ImagenPanel,
  ORDEN_IMAGENES,
  SELECCION_IMAGEN,
} from './imagenes.service.js';

/**
 * Lo que el panel ve de un formato. Incluye la fecha de vencimiento, que la tienda nunca
 * muestra (E3-H2), y las imágenes de su artículo (E3-H3). Los precios no van aquí: son de E3-H5.
 */
const SELECCION = {
  id: true,
  productoId: true,
  codigoBarras: true,
  nombreFormato: true,
  contenido: true,
  unidadMedida: true,
  fechaVencimiento: true,
  stockMinimo: true,
  pesoGramos: true,
  altoCm: true,
  anchoCm: true,
  largoCm: true,
  esPredeterminado: true,
  articulo: {
    select: {
      sku: true,
      activo: true,
      imagenes: { select: SELECCION_IMAGEN, orderBy: ORDEN_IMAGENES },
    },
  },
} satisfies Prisma.FormatoProductoSelect;

type FilaFormato = Prisma.FormatoProductoGetPayload<{
  select: typeof SELECCION;
}>;

/** Formato tal como lo devuelve el panel: decimales como número y la fecha en AAAA-MM-DD. */
export interface FormatoPanel {
  id: number;
  productoId: number;
  sku: string;
  codigoBarras: string | null;
  nombreFormato: string;
  contenido: number | null;
  unidadMedida: string | null;
  fechaVencimiento: string | null;
  stockMinimo: number;
  pesoGramos: number;
  altoCm: number;
  anchoCm: number;
  largoCm: number;
  esPredeterminado: boolean;
  activo: boolean;
  /** Imágenes del artículo en su orden (E3-H3); el formato puede no tener todavía. */
  imagenes: ImagenPanel[];
}

const aRespuesta = (
  fila: FilaFormato,
  urlBaseImagenes: string | undefined,
): FormatoPanel => ({
  id: fila.id,
  productoId: fila.productoId,
  sku: fila.articulo.sku,
  codigoBarras: fila.codigoBarras,
  nombreFormato: fila.nombreFormato,
  contenido: fila.contenido === null ? null : Number(fila.contenido),
  unidadMedida: fila.unidadMedida,
  fechaVencimiento: fila.fechaVencimiento?.toISOString().slice(0, 10) ?? null,
  stockMinimo: fila.stockMinimo,
  pesoGramos: fila.pesoGramos,
  altoCm: Number(fila.altoCm),
  anchoCm: Number(fila.anchoCm),
  largoCm: Number(fila.largoCm),
  esPredeterminado: fila.esPredeterminado,
  activo: fila.articulo.activo,
  imagenes: fila.articulo.imagenes.map((imagen) =>
    aImagenPanel(imagen, urlBaseImagenes),
  ),
});

/** La fecha llega validada como AAAA-MM-DD; `null` la borra y `undefined` no la cambia. */
const aFecha = (valor: string | null | undefined) =>
  valor ? new Date(`${valor}T00:00:00Z`) : valor;

/** Contenido y unidad de medida van juntos: los dos o ninguno. */
const exigirContenidoConUnidad = (
  contenido: number | null | undefined,
  unidadMedida: string | null | undefined,
) => {
  if (((contenido ?? null) === null) !== ((unidadMedida ?? null) === null)) {
    throw new BadRequestException(
      'Indica el contenido junto con su unidad de medida.',
    );
  }
};

type Cliente = Prisma.TransactionClient | PrismaService;

@Injectable()
export class FormatosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
  ) {}

  /** Formatos de un producto para el panel, con el predeterminado primero. */
  async listar(productoId: number): Promise<FormatoPanel[]> {
    const producto = await this.prisma.producto.findUnique({
      where: { id: productoId },
      select: { id: true },
    });
    if (!producto) {
      throw new NotFoundException('El producto no existe.');
    }
    const filas = await this.prisma.formatoProducto.findMany({
      where: { productoId },
      select: SELECCION,
      orderBy: [{ esPredeterminado: 'desc' }, { id: 'asc' }],
    });
    return filas.map((fila) => this.aRespuesta(fila));
  }

  /**
   * Agrega un formato a un producto (E3-H2, RF-03.02): crea el artículo de venta (sin precios,
   * que se fijan en E3-H5) y su formato en una transacción. El SKU no puede pertenecer a otro
   * artículo ni el código de barras a otro formato. El primer formato del producto queda como
   * predeterminado; si se marca otro, el anterior deja de serlo. La fila del producto queda
   * bloqueada para que dos guardados simultáneos no dejen dos predeterminados.
   */
  async crear(productoId: number, dto: CrearFormatoDto): Promise<FormatoPanel> {
    exigirContenidoConUnidad(dto.contenido, dto.unidadMedida);
    try {
      const fila = await this.prisma.$transaction(async (tx) => {
        await bloquearProducto(tx, productoId);
        await this.exigirDatosLibres(tx, dto.sku, dto.codigoBarras);
        const otros = await tx.formatoProducto.count({ where: { productoId } });
        const esPredeterminado = otros === 0 || dto.esPredeterminado === true;
        if (esPredeterminado && otros > 0) {
          await tx.formatoProducto.updateMany({
            where: { productoId, esPredeterminado: true },
            data: { esPredeterminado: false },
          });
        }
        const articulo = await tx.articuloVenta.create({
          data: { sku: dto.sku, tipo: TIPOS_ARTICULO.FORMATO },
          select: { id: true },
        });
        return tx.formatoProducto.create({
          data: {
            id: articulo.id,
            productoId,
            codigoBarras: dto.codigoBarras ?? null,
            nombreFormato: dto.nombreFormato,
            contenido: dto.contenido ?? null,
            unidadMedida: dto.unidadMedida ?? null,
            fechaVencimiento: aFecha(dto.fechaVencimiento) ?? null,
            stockMinimo: dto.stockMinimo ?? 0,
            pesoGramos: dto.pesoGramos,
            altoCm: dto.altoCm,
            anchoCm: dto.anchoCm,
            largoCm: dto.largoCm,
            esPredeterminado,
          },
          select: SELECCION,
        });
      });
      return this.aRespuesta(fila);
    } catch (error) {
      await this.explicarChoque(error, dto.sku, dto.codigoBarras);
      throw error;
    }
  }

  /**
   * Cambia los datos de un formato (E3-H2). Solo se modifica lo que llega. Marcarlo como
   * predeterminado desmarca a los demás formatos del producto; desmarcar el predeterminado no
   * se puede (se marca otro), así el producto nunca se queda sin uno.
   */
  async actualizar(
    id: number,
    dto: ActualizarFormatoDto,
  ): Promise<FormatoPanel> {
    if (Object.values(dto).every((valor) => valor === undefined)) {
      throw new BadRequestException('Indica al menos un campo para cambiar.');
    }
    if (dto.contenido !== undefined || dto.unidadMedida !== undefined) {
      if (dto.contenido === undefined || dto.unidadMedida === undefined) {
        throw new BadRequestException(
          'Indica el contenido junto con su unidad de medida.',
        );
      }
      exigirContenidoConUnidad(dto.contenido, dto.unidadMedida);
    }
    try {
      const fila = await this.prisma.$transaction(async (tx) => {
        const productoId = await bloquearProductoDelFormato(tx, id);
        const actual = await tx.formatoProducto.findUnique({
          where: { id },
          select: { esPredeterminado: true },
        });
        if (!actual) {
          throw new NotFoundException('El formato no existe.');
        }
        if (dto.esPredeterminado === false && actual.esPredeterminado) {
          throw new BadRequestException(
            'El producto necesita un formato predeterminado: marca otro formato como predeterminado.',
          );
        }
        await this.exigirDatosLibres(tx, dto.sku, dto.codigoBarras, id);
        const marcar =
          dto.esPredeterminado === true && !actual.esPredeterminado;
        // El artículo antes que sus formatos, el mismo orden del pedido (E5-H3), que lo referencia
        // al insertar su detalle y luego bloquea los formatos: al revés habría deadlock
        if (dto.sku !== undefined) {
          await tx.articuloVenta.update({
            where: { id },
            data: { sku: dto.sku },
          });
        }
        if (marcar) {
          // Antes de tocar el predeterminado anterior y este, en orden de id (sin deadlock con
          // un movimiento de stock de los mismos formatos)
          await bloquearFormatosDelProducto(tx, productoId);
          await tx.formatoProducto.updateMany({
            where: { productoId, esPredeterminado: true, id: { not: id } },
            data: { esPredeterminado: false },
          });
        }
        return tx.formatoProducto.update({
          where: { id },
          data: {
            codigoBarras: dto.codigoBarras,
            nombreFormato: dto.nombreFormato,
            contenido: dto.contenido,
            unidadMedida: dto.unidadMedida,
            fechaVencimiento: aFecha(dto.fechaVencimiento),
            stockMinimo: dto.stockMinimo,
            pesoGramos: dto.pesoGramos,
            altoCm: dto.altoCm,
            anchoCm: dto.anchoCm,
            largoCm: dto.largoCm,
            esPredeterminado: marcar ? true : undefined,
          },
          select: SELECCION,
        });
      });
      return this.aRespuesta(fila);
    } catch (error) {
      await this.explicarChoque(error, dto.sku, dto.codigoBarras, id);
      throw error;
    }
  }

  private aRespuesta(fila: FilaFormato) {
    return aRespuesta(fila, this.config.get('R2_URL_PUBLICA', { infer: true }));
  }

  /**
   * El SKU no puede pertenecer a otro artículo (formato o pack) ni el código de barras a otro
   * formato. Responde 409 indicando el dato repetido (criterio 2 de E3-H2).
   */
  private async exigirDatosLibres(
    cliente: Cliente,
    sku: string | undefined,
    codigoBarras: string | null | undefined,
    excluirId?: number,
  ) {
    const otro = excluirId === undefined ? undefined : { not: excluirId };
    const skuOcupado = sku
      ? await cliente.articuloVenta.findFirst({
          where: { sku, id: otro },
          select: { id: true },
        })
      : null;
    const codigoOcupado = codigoBarras
      ? await cliente.formatoProducto.findFirst({
          where: { codigoBarras, id: otro },
          select: { id: true },
        })
      : null;
    if (skuOcupado && codigoOcupado) {
      throw new ConflictException(
        'El SKU y el código de barras ya pertenecen a otro artículo.',
      );
    }
    if (skuOcupado) {
      throw new ConflictException('El SKU ya pertenece a otro artículo.');
    }
    if (codigoOcupado) {
      throw new ConflictException(
        'El código de barras ya pertenece a otro artículo.',
      );
    }
  }

  /**
   * Dos guardados simultáneos con el mismo SKU o código de barras: gana el primero y al segundo
   * la base le responde P2002. Se revisa de nuevo para indicar qué dato se repitió.
   */
  private async explicarChoque(
    error: unknown,
    sku: string | undefined,
    codigoBarras: string | null | undefined,
    excluirId?: number,
  ) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return;
    }
    await this.exigirDatosLibres(this.prisma, sku, codigoBarras, excluirId);
    throw new ConflictException(
      'El SKU o el código de barras ya pertenece a otro artículo.',
    );
  }
}
