import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  AlmacenArchivos,
  urlPublicaArchivo,
} from '../../almacen/almacen-archivos.js';
import type { Entorno } from '../../config/entorno.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { OrdenarImagenesDto } from './dto/ordenar-imagenes.dto.js';
import { detectarTipoImagen } from './tipo-imagen.js';

/** Imágenes que puede tener un artículo (E3-H3, decisión del 24 oct). */
export const MAXIMO_IMAGENES_ARTICULO = 10;
/** Tamaño máximo de cada imagen (E3-H3, decisión del 24 oct). */
export const TAMANO_MAXIMO_IMAGEN_BYTES = 5 * 1024 * 1024;

/** Lo que el servicio necesita del archivo que recibe el controlador (multer, en memoria). */
export interface ArchivoSubido {
  buffer: Buffer;
  size: number;
}

/** Imagen de un artículo tal como la ve el panel. */
export interface ImagenPanel {
  id: number;
  url: string;
  orden: number;
  esPrincipal: boolean;
}

/** Columnas de una imagen que necesita el panel (también las usa la ficha del formato). */
export const SELECCION_IMAGEN = {
  id: true,
  ubicacionArchivo: true,
  orden: true,
  esPrincipal: true,
} satisfies Prisma.ImagenArticuloSelect;

/** Orden en que se muestran las imágenes de un artículo. */
export const ORDEN_IMAGENES = [
  { orden: 'asc' },
  { id: 'asc' },
] satisfies Prisma.ImagenArticuloOrderByWithRelationInput[];

type FilaImagen = Prisma.ImagenArticuloGetPayload<{
  select: typeof SELECCION_IMAGEN;
}>;

/** Imagen para el panel, con la URL armada desde el dominio público del almacén. */
export const aImagenPanel = (
  fila: FilaImagen,
  urlBase: string | undefined,
): ImagenPanel => ({
  id: fila.id,
  url: urlPublicaArchivo(urlBase, fila.ubicacionArchivo),
  orden: fila.orden,
  esPrincipal: fila.esPrincipal,
});

/**
 * Imágenes de cada artículo de venta (E3-H3, RF-03.04). Un artículo tiene hasta 10 imágenes,
 * con el orden 1..n sin huecos y una sola principal; una vez que tiene imágenes, nunca se queda
 * sin ninguna. Los cambios bloquean la fila del artículo, así dos guardados simultáneos no
 * dejan dos principales ni pasan del máximo.
 */
@Injectable()
export class ImagenesService {
  private readonly logger = new Logger(ImagenesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacen: AlmacenArchivos,
    private readonly config: ConfigService<Entorno, true>,
  ) {}

  /** Imágenes del artículo en su orden. */
  async listar(articuloId: number): Promise<ImagenPanel[]> {
    const articulo = await this.prisma.articuloVenta.findUnique({
      where: { id: articuloId },
      select: { id: true },
    });
    if (!articulo) {
      throw new NotFoundException('El artículo no existe.');
    }
    return this.imagenesDe(this.prisma, articuloId);
  }

  /**
   * Sube una imagen al almacén y la agrega al final del orden; la primera del artículo queda
   * como principal. El archivo se sube antes de la transacción (no se espera a un servicio
   * externo con la fila bloqueada) y se borra si la base no lo llega a registrar.
   */
  async subir(
    articuloId: number,
    archivo: ArchivoSubido | undefined,
  ): Promise<ImagenPanel[]> {
    if (!archivo) {
      throw new BadRequestException(
        'Adjunta una imagen JPEG, PNG o WebP en el campo «imagen».',
      );
    }
    if (archivo.size > TAMANO_MAXIMO_IMAGEN_BYTES) {
      throw new BadRequestException('La imagen no puede superar los 5 MB.');
    }
    const tipo = detectarTipoImagen(archivo.buffer);
    if (!tipo) {
      throw new BadRequestException('La imagen debe ser JPEG, PNG o WebP.');
    }
    const articulo = await this.prisma.articuloVenta.findUnique({
      where: { id: articuloId },
      select: { id: true, _count: { select: { imagenes: true } } },
    });
    if (!articulo) {
      throw new NotFoundException('El artículo no existe.');
    }
    // Revisión previa para no subir un archivo que no se va a poder registrar
    exigirCupo(articulo._count.imagenes);

    const clave = `articulos/${articuloId}/${randomUUID()}.${tipo.extension}`;
    try {
      await this.almacen.guardar(clave, archivo.buffer, tipo.tipoContenido);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.warn(
        `No se pudo guardar ${clave} en el almacén: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'No se pudo guardar la imagen. Intenta de nuevo en unos minutos.',
      );
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.bloquearArticulo(tx, articuloId);
        const cantidad = await tx.imagenArticulo.count({
          where: { articuloId },
        });
        exigirCupo(cantidad);
        await tx.imagenArticulo.create({
          data: {
            articuloId,
            ubicacionArchivo: clave,
            orden: cantidad + 1,
            esPrincipal: cantidad === 0,
          },
        });
      });
    } catch (error) {
      await this.borrarArchivo(clave);
      throw error;
    }
    return this.imagenesDe(this.prisma, articuloId);
  }

  /**
   * Guarda el nuevo orden y deja como principal solo a `principalId`. El orden debe traer
   * exactamente las imágenes del artículo, cada una una vez.
   */
  async ordenar(
    articuloId: number,
    dto: OrdenarImagenesDto,
  ): Promise<ImagenPanel[]> {
    return this.prisma.$transaction(async (tx) => {
      await this.bloquearArticulo(tx, articuloId);
      const actuales = await tx.imagenArticulo.findMany({
        where: { articuloId },
        select: SELECCION_IMAGEN,
        orderBy: ORDEN_IMAGENES,
      });
      const ids = new Set(actuales.map((fila) => fila.id));
      const ordenCompleto =
        dto.orden.length === ids.size &&
        new Set(dto.orden).size === ids.size &&
        dto.orden.every((id) => ids.has(id));
      if (!ordenCompleto) {
        throw new BadRequestException(
          'Indica todas las imágenes del artículo, cada una una vez.',
        );
      }
      if (!ids.has(dto.principalId)) {
        throw new BadRequestException(
          'La imagen principal debe ser una de las imágenes del artículo.',
        );
      }
      for (const [indice, id] of dto.orden.entries()) {
        await tx.imagenArticulo.update({
          where: { id },
          data: { orden: indice + 1, esPrincipal: id === dto.principalId },
        });
      }
      return this.imagenesDe(tx, articuloId);
    });
  }

  /**
   * Elimina una imagen y cierra el hueco del orden. Si era la principal, la siguiente pasa a
   * serlo. La única imagen del artículo no se elimina (criterio 3). El archivo se borra del
   * almacén después de confirmar la transacción; si eso falla, solo queda registrado en el log.
   */
  async eliminar(articuloId: number, imagenId: number): Promise<ImagenPanel[]> {
    const { eliminada, restantes } = await this.prisma.$transaction(
      async (tx) => {
        await this.bloquearArticulo(tx, articuloId);
        const actuales = await tx.imagenArticulo.findMany({
          where: { articuloId },
          select: SELECCION_IMAGEN,
          orderBy: ORDEN_IMAGENES,
        });
        const eliminada = actuales.find((fila) => fila.id === imagenId);
        if (!eliminada) {
          throw new NotFoundException('La imagen no existe.');
        }
        if (actuales.length === 1) {
          throw new ConflictException(
            'El artículo debe tener al menos una imagen: sube otra antes de eliminar esta.',
          );
        }
        await tx.imagenArticulo.delete({ where: { id: imagenId } });
        const restantes = actuales.filter((fila) => fila.id !== imagenId);
        const renumeradas = restantes.map((fila, indice) => ({
          ...fila,
          orden: indice + 1,
          esPrincipal: eliminada.esPrincipal ? indice === 0 : fila.esPrincipal,
        }));
        for (const [indice, fila] of renumeradas.entries()) {
          const antes = restantes[indice];
          if (
            fila.orden !== antes.orden ||
            fila.esPrincipal !== antes.esPrincipal
          ) {
            await tx.imagenArticulo.update({
              where: { id: fila.id },
              data: { orden: fila.orden, esPrincipal: fila.esPrincipal },
            });
          }
        }
        return { eliminada, restantes: renumeradas };
      },
    );
    await this.borrarArchivo(eliminada.ubicacionArchivo);
    return restantes.map((fila) => this.aRespuesta(fila));
  }

  private async imagenesDe(
    cliente: Prisma.TransactionClient | PrismaService,
    articuloId: number,
  ) {
    const filas = await cliente.imagenArticulo.findMany({
      where: { articuloId },
      select: SELECCION_IMAGEN,
      orderBy: ORDEN_IMAGENES,
    });
    return filas.map((fila) => this.aRespuesta(fila));
  }

  private aRespuesta(fila: FilaImagen): ImagenPanel {
    return aImagenPanel(
      fila,
      this.config.get('R2_URL_PUBLICA', { infer: true }),
    );
  }

  /** Bloquea la fila del artículo hasta el fin de la transacción (RNF-12). */
  private async bloquearArticulo(tx: Prisma.TransactionClient, id: number) {
    const [articulo] = await tx.$queryRaw<{ id: number }[]>`
      SELECT id_articulo AS id FROM articulo_venta
      WHERE id_articulo = ${id}
      FOR UPDATE`;
    if (!articulo) {
      throw new NotFoundException('El artículo no existe.');
    }
  }

  /** Un archivo que no se pudo borrar solo ocupa espacio: no hace fallar la operación. */
  private async borrarArchivo(clave: string) {
    try {
      await this.almacen.eliminar(clave);
    } catch (error) {
      this.logger.warn(
        `No se pudo borrar ${clave} del almacén: ${(error as Error).message}`,
      );
    }
  }
}

const exigirCupo = (cantidad: number) => {
  if (cantidad >= MAXIMO_IMAGENES_ARTICULO) {
    throw new ConflictException(
      `El artículo ya tiene ${MAXIMO_IMAGENES_ARTICULO} imágenes: elimina una antes de subir otra.`,
    );
  }
};
