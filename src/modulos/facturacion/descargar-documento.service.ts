import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AlmacenArchivos } from '../../almacen/almacen-archivos.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PEDIDO_NO_EXISTE } from '../pedidos/codigo-pedido.pipe.js';
import { FACTURA_CON_ARCHIVO } from './documento-pedido.js';

export const DOCUMENTO_PENDIENTE =
  'El documento del pedido aún no está disponible.';
export const DOCUMENTO_NO_DISPONIBLE =
  'No se pudo obtener el documento. Intenta de nuevo en unos minutos.';

/** El PDF listo para entregar, con el nombre con que se descarga. */
export interface ArchivoDocumento {
  contenido: Buffer;
  nombre: string;
}

/**
 * Descarga del documento tributario (E9-H4, RF-09.06). El cliente o profesional solo descarga el
 * de un pedido de su cuenta (el de otra cuenta responde igual que uno que no existe); el personal
 * con `facturacion.gestionar` descarga el de cualquier pedido (decisión del equipo del 1 nov). El
 * archivo es privado: se lee del almacén y se entrega por la API, nunca con una URL pública.
 */
@Injectable()
export class DescargarDocumentoService {
  private readonly logger = new Logger(DescargarDocumentoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacen: AlmacenArchivos,
  ) {}

  /** El dueño del pedido: siempre buscando en la cuenta del token. */
  descargar(
    codigoPublico: string,
    codigoPedido: string,
  ): Promise<ArchivoDocumento> {
    return this.entregar({
      codigoPublico: codigoPedido,
      usuario: { codigoPublico },
    });
  }

  /** El personal con `facturacion.gestionar`: la factura de cualquier pedido. */
  descargarComoPersonal(codigoPedido: string): Promise<ArchivoDocumento> {
    return this.entregar({ codigoPublico: codigoPedido });
  }

  private async entregar(
    donde: Prisma.PedidoWhereInput,
  ): Promise<ArchivoDocumento> {
    const pedido = await this.prisma.pedido.findFirst({
      where: donde,
      select: {
        documentos: {
          where: FACTURA_CON_ARCHIVO,
          select: { folio: true, ubicacionArchivo: true },
          orderBy: { id: 'desc' },
          take: 1,
        },
      },
    });
    if (!pedido) throw new NotFoundException(PEDIDO_NO_EXISTE);
    const documento = pedido.documentos[0];
    if (!documento) throw new NotFoundException(DOCUMENTO_PENDIENTE);

    const clave = documento.ubicacionArchivo as string;
    try {
      return {
        contenido: await this.almacen.obtener(clave),
        // El folio es un entero: el nombre no puede traer caracteres raros
        nombre: `factura-${documento.folio}.pdf`,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `No se pudo leer ${clave} del almacén: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(DOCUMENTO_NO_DISPONIBLE);
    }
  }
}
