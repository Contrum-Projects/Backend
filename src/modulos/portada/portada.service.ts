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
import { errorDeCampo } from '../../common/errores/error-de-campo.js';
import { TIPOS_DESTINO_PORTADA } from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CANDADOS, tomarCandado } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  type ArchivoSubido,
  TAMANO_MAXIMO_IMAGEN_BYTES,
} from '../catalogo/imagenes.service.js';
import {
  detectarTipoImagen,
  type TipoImagen,
} from '../catalogo/tipo-imagen.js';
import {
  claveDestino,
  type DestinoResuelto,
  DestinosPortada,
  idDeDestino,
  type OpcionDestino,
  type TipoDestinoPortada,
} from './destinos-portada.js';
import type { DestinoPortadaDto } from './dto/destino-portada.dto.js';
import type { OrdenarSlidesDto } from './dto/ordenar-slides.dto.js';
import type {
  SlidePortadaDto,
  SlidePortadaPanelDto,
} from './dto/slide-portada.dto.js';

/** Slides que puede tener la portada (SCRUM-157). */
export const MAXIMO_SLIDES_PORTADA = 8;

/** Las dos versiones de la imagen de un slide; también son los campos del formulario. */
export const VERSIONES_IMAGEN = {
  ESCRITORIO: 'escritorio',
  CELULAR: 'celular',
} as const;
export type VersionImagen =
  (typeof VERSIONES_IMAGEN)[keyof typeof VERSIONES_IMAGEN];

const SELECCION_SLIDE = {
  id: true,
  imagenEscritorio: true,
  imagenCelular: true,
  orden: true,
  tipoDestino: true,
  destino: true,
} satisfies Prisma.SlidePortadaSelect;

const ORDEN_SLIDES = [
  { orden: 'asc' },
  { id: 'asc' },
] satisfies Prisma.SlidePortadaOrderByWithRelationInput[];

type FilaSlide = Prisma.SlidePortadaGetPayload<{
  select: typeof SELECCION_SLIDE;
}>;

const SIN_DESTINO: DestinoResuelto = { nombre: null, disponible: false };

/**
 * Portada del inicio (SCRUM-157): slides con una imagen de escritorio, una de celular opcional y
 * un destino elegido de una lista. Hasta 8, con orden 1..n sin huecos. Los cambios toman un
 * mismo bloqueo de transacción, así dos guardados simultáneos no pasan del máximo ni dejan
 * órdenes repetidos. Los archivos se suben antes de la transacción y se borran del almacén
 * después de confirmarla, como las fotos del catálogo (E3-H3).
 */
@Injectable()
export class PortadaService {
  private readonly logger = new Logger(PortadaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacen: AlmacenArchivos,
    private readonly destinos: DestinosPortada,
    private readonly config: ConfigService<Entorno, true>,
  ) {}

  /** Lo que muestra la tienda: solo los slides cuyo destino está a la venta, en su orden. */
  async listarTienda(): Promise<SlidePortadaDto[]> {
    const slides = await this.listarPanel();
    return slides
      .filter((slide) => slide.disponible)
      .map(({ id, imagenEscritorio, imagenCelular, destino }) => ({
        id,
        imagenEscritorio,
        imagenCelular,
        destino,
      }));
  }

  /** Todos los slides, con su orden y si la tienda los muestra. */
  async listarPanel(): Promise<SlidePortadaPanelDto[]> {
    return this.slidesDe(this.prisma);
  }

  /** Destinos de un tipo que se pueden elegir (solo los que la tienda muestra). */
  opcionesDestino(
    tipo: TipoDestinoPortada,
    buscar?: string,
  ): Promise<OpcionDestino[]> {
    return this.destinos.opciones(tipo, buscar);
  }

  /** Agrega un slide al final. La imagen de escritorio es obligatoria; la de celular, no. */
  async crear(
    dto: DestinoPortadaDto,
    escritorio: ArchivoSubido | undefined,
    celular: ArchivoSubido | undefined,
  ): Promise<SlidePortadaPanelDto[]> {
    if (!escritorio) {
      throw errorDeCampo(
        BadRequestException,
        'Sube la imagen para escritorio.',
        VERSIONES_IMAGEN.ESCRITORIO,
      );
    }
    const tipoEscritorio = validarImagen(
      escritorio,
      VERSIONES_IMAGEN.ESCRITORIO,
    );
    const tipoCelular = celular
      ? validarImagen(celular, VERSIONES_IMAGEN.CELULAR)
      : null;
    await this.exigirDestinoDisponible(dto);
    // Revisión previa para no subir archivos que no se van a poder registrar
    exigirCupo(await this.prisma.slidePortada.count());

    const claveEscritorio = await this.guardar(escritorio, tipoEscritorio);
    let claveCelular: string | null = null;
    try {
      if (celular && tipoCelular) {
        claveCelular = await this.guardar(celular, tipoCelular);
      }
      await this.prisma.$transaction(async (tx) => {
        await tomarCandado(tx, CANDADOS.PORTADA);
        const cantidad = await tx.slidePortada.count();
        exigirCupo(cantidad);
        await tx.slidePortada.create({
          data: {
            imagenEscritorio: claveEscritorio,
            imagenCelular: claveCelular,
            orden: cantidad + 1,
            tipoDestino: dto.tipoDestino,
            destino: dto.destino,
          },
        });
      });
    } catch (error) {
      await this.borrarArchivo(claveEscritorio);
      if (claveCelular) await this.borrarArchivo(claveCelular);
      throw error;
    }
    return this.slidesDe(this.prisma);
  }

  /** Cambia a dónde lleva un slide. */
  async cambiarDestino(
    id: number,
    dto: DestinoPortadaDto,
  ): Promise<SlidePortadaPanelDto[]> {
    await this.exigirDestinoDisponible(dto);
    return this.prisma.$transaction(async (tx) => {
      await tomarCandado(tx, CANDADOS.PORTADA);
      await exigirSlide(tx, id);
      await tx.slidePortada.update({
        where: { id },
        data: { tipoDestino: dto.tipoDestino, destino: dto.destino },
      });
      return this.slidesDe(tx);
    });
  }

  /** Reemplaza (o agrega, si era la de celular y no tenía) una de las imágenes del slide. */
  async reemplazarImagen(
    id: number,
    version: VersionImagen,
    archivo: ArchivoSubido | undefined,
  ): Promise<SlidePortadaPanelDto[]> {
    if (!archivo) {
      throw errorDeCampo(
        BadRequestException,
        'Adjunta una imagen JPEG, PNG o WebP en el campo «imagen».',
        'imagen',
      );
    }
    const tipo = validarImagen(archivo, 'imagen');
    await exigirSlide(this.prisma, id);

    const nueva = await this.guardar(archivo, tipo);
    let anterior: string | null;
    let slides: SlidePortadaPanelDto[];
    try {
      ({ anterior, slides } = await this.prisma.$transaction(async (tx) => {
        await tomarCandado(tx, CANDADOS.PORTADA);
        const fila = await exigirSlide(tx, id);
        await tx.slidePortada.update({
          where: { id },
          data:
            version === VERSIONES_IMAGEN.ESCRITORIO
              ? { imagenEscritorio: nueva }
              : { imagenCelular: nueva },
        });
        return {
          anterior:
            version === VERSIONES_IMAGEN.ESCRITORIO
              ? fila.imagenEscritorio
              : fila.imagenCelular,
          slides: await this.slidesDe(tx),
        };
      }));
    } catch (error) {
      await this.borrarArchivo(nueva);
      throw error;
    }
    if (anterior) await this.borrarArchivo(anterior);
    return slides;
  }

  /** Quita la imagen de celular: el celular vuelve a mostrar la de escritorio. */
  async quitarImagenCelular(id: number): Promise<SlidePortadaPanelDto[]> {
    const { anterior, slides } = await this.prisma.$transaction(async (tx) => {
      await tomarCandado(tx, CANDADOS.PORTADA);
      const fila = await exigirSlide(tx, id);
      if (fila.imagenCelular) {
        await tx.slidePortada.update({
          where: { id },
          data: { imagenCelular: null },
        });
      }
      return { anterior: fila.imagenCelular, slides: await this.slidesDe(tx) };
    });
    if (anterior) await this.borrarArchivo(anterior);
    return slides;
  }

  /** Guarda el nuevo orden: debe traer todos los slides, cada uno una vez. */
  async ordenar(dto: OrdenarSlidesDto): Promise<SlidePortadaPanelDto[]> {
    return this.prisma.$transaction(async (tx) => {
      await tomarCandado(tx, CANDADOS.PORTADA);
      const actuales = await tx.slidePortada.findMany({ select: { id: true } });
      const ids = new Set(actuales.map((fila) => fila.id));
      const completo =
        dto.orden.length === ids.size &&
        new Set(dto.orden).size === ids.size &&
        dto.orden.every((id) => ids.has(id));
      if (!completo) {
        throw errorDeCampo(
          BadRequestException,
          'Indica todas las imágenes de la portada, cada una una vez.',
          'orden',
        );
      }
      for (const [indice, id] of dto.orden.entries()) {
        await tx.slidePortada.update({
          where: { id },
          data: { orden: indice + 1 },
        });
      }
      return this.slidesDe(tx);
    });
  }

  /** Elimina un slide y cierra el hueco del orden. Sus archivos se borran después. */
  async eliminar(id: number): Promise<SlidePortadaPanelDto[]> {
    const { eliminado, slides } = await this.prisma.$transaction(async (tx) => {
      await tomarCandado(tx, CANDADOS.PORTADA);
      const eliminado = await exigirSlide(tx, id);
      await tx.slidePortada.delete({ where: { id } });
      await tx.slidePortada.updateMany({
        where: { orden: { gt: eliminado.orden } },
        data: { orden: { decrement: 1 } },
      });
      return { eliminado, slides: await this.slidesDe(tx) };
    });
    await this.borrarArchivo(eliminado.imagenEscritorio);
    if (eliminado.imagenCelular) {
      await this.borrarArchivo(eliminado.imagenCelular);
    }
    return slides;
  }

  /** El destino debe existir y estar a la venta para cualquier visitante. */
  private async exigirDestinoDisponible(dto: DestinoPortadaDto) {
    const esPagina = dto.tipoDestino === TIPOS_DESTINO_PORTADA.PAGINA;
    if (!esPagina && idDeDestino(dto.destino) === null) {
      throw errorDeCampo(
        BadRequestException,
        'El destino elegido no es válido.',
        'destino',
      );
    }
    const resuelto = await this.destinos.resolverUno(
      dto.tipoDestino,
      dto.destino,
    );
    if (!resuelto.disponible) {
      throw errorDeCampo(
        BadRequestException,
        'El destino elegido no existe o no está a la venta en la tienda.',
        'destino',
      );
    }
  }

  private async slidesDe(
    cliente: Prisma.TransactionClient | PrismaService,
  ): Promise<SlidePortadaPanelDto[]> {
    const filas = await cliente.slidePortada.findMany({
      select: SELECCION_SLIDE,
      orderBy: ORDEN_SLIDES,
    });
    if (filas.length === 0) return [];
    const resueltos = await this.destinos.resolver(filas);
    return filas.map((fila) =>
      this.aRespuesta(
        fila,
        resueltos.get(claveDestino(fila.tipoDestino, fila.destino)) ??
          SIN_DESTINO,
      ),
    );
  }

  private aRespuesta(
    fila: FilaSlide,
    resuelto: DestinoResuelto,
  ): SlidePortadaPanelDto {
    const base = this.config.get('R2_URL_PUBLICA', { infer: true });
    return {
      id: fila.id,
      imagenEscritorio: urlPublicaArchivo(base, fila.imagenEscritorio),
      imagenCelular: fila.imagenCelular
        ? urlPublicaArchivo(base, fila.imagenCelular)
        : null,
      orden: fila.orden,
      disponible: resuelto.disponible,
      destino: {
        tipo: fila.tipoDestino as TipoDestinoPortada,
        destino: fila.destino,
        nombre: resuelto.nombre,
      },
    };
  }

  private async guardar(archivo: ArchivoSubido, tipo: TipoImagen) {
    const clave = `portada/${randomUUID()}.${tipo.extension}`;
    try {
      await this.almacen.guardar(clave, archivo.buffer, tipo.tipoContenido);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(
        `No se pudo guardar ${clave} en el almacén: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'No se pudo guardar la imagen. Intenta de nuevo en unos minutos.',
      );
    }
    return clave;
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

/** Misma regla que las fotos del catálogo: JPEG, PNG o WebP de hasta 4 MB, por su contenido. */
const validarImagen = (archivo: ArchivoSubido, campo: string): TipoImagen => {
  if (archivo.size > TAMANO_MAXIMO_IMAGEN_BYTES) {
    throw errorDeCampo(
      BadRequestException,
      'La imagen no puede superar los 4 MB.',
      campo,
    );
  }
  const tipo = detectarTipoImagen(archivo.buffer);
  if (!tipo) {
    throw errorDeCampo(
      BadRequestException,
      'La imagen debe ser JPEG, PNG o WebP.',
      campo,
    );
  }
  return tipo;
};

const exigirCupo = (cantidad: number) => {
  if (cantidad >= MAXIMO_SLIDES_PORTADA) {
    throw new ConflictException(
      `La portada ya tiene ${MAXIMO_SLIDES_PORTADA} imágenes: elimina una antes de agregar otra.`,
    );
  }
};

const exigirSlide = async (
  cliente: Prisma.TransactionClient | PrismaService,
  id: number,
): Promise<FilaSlide> => {
  const fila = await cliente.slidePortada.findUnique({
    where: { id },
    select: SELECCION_SLIDE,
  });
  if (!fila) throw new NotFoundException('La imagen de la portada no existe.');
  return fila;
};
