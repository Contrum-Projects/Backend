import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AlmacenArchivos } from '../../almacen/almacen-archivos.js';
import {
  ESTADOS_OCR,
  ESTADOS_SOLICITUD,
} from '../../common/dominio/valores.js';
import { bloquearCuenta } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AdjuntarDocumentosDto } from './dto/adjuntar-documentos.dto.js';
import {
  aSolicitudCuenta,
  SELECCION_SOLICITUD,
  SIN_SOLICITUD,
  type SolicitudVerificacionCuenta,
  YA_APROBADA,
} from './solicitud-verificacion.service.js';
import {
  detectarTipoAntecedente,
  MAXIMO_ANTECEDENTES,
  TAMANO_MAXIMO_ANTECEDENTE_BYTES,
  type TipoArchivoAntecedente,
} from './tipo-archivo-antecedente.js';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';

export const SIN_ARCHIVOS = `Adjunta de 1 a ${MAXIMO_ANTECEDENTES} documentos en el campo «archivos».`;
export const TIPOS_NO_COINCIDEN =
  'Indica el tipo de cada documento: debe haber un tipo por archivo y en el mismo orden.';
export const DOCUMENTO_MUY_GRANDE = 'Cada documento puede pesar hasta 4 MB.';
export const documentoNoValido = (numero: number) =>
  `El documento ${numero} debe ser un PDF, JPG o PNG.`;
export const SOLICITUD_RECHAZADA =
  'Tu solicitud fue rechazada. Envía una nueva solicitud de verificación.';
export const DOCUMENTOS_YA_ENVIADOS =
  'Ya enviaste tus documentos: el personal de la tienda los está revisando.';

/** Lo que el servicio necesita de cada archivo que recibe el controlador (multer, en memoria). */
export interface ArchivoAntecedente {
  buffer: Buffer;
  size: number;
  originalname: string;
}

interface DocumentoRevisado {
  contenido: Buffer;
  tipo: string;
  nombreArchivo: string;
  formato: TipoArchivoAntecedente;
}

interface DocumentoGuardado extends DocumentoRevisado {
  clave: string;
}

/**
 * Documentos que respaldan la solicitud de quien no pasó la verificación automática (E10-H2,
 * RF-10.01, RF-10.05 y RF-10.09). La cuenta adjunta de 1 a 5 documentos (PDF, JPG o PNG, de hasta
 * 4 MB) y la solicitud pasa de `pendiente` a `revision_manual`, a la espera del personal (E10-H3).
 * No hay OCR ni puntaje: los documentos los lee una persona. El motivo por el que se piden ya
 * quedó en la solicitud, en el resultado de la consulta al SII (E10-H1).
 *
 * Los archivos se suben al almacén, privados, antes de la transacción (no se espera a un servicio
 * externo con la cuenta bloqueada) y se borran si la base no llega a registrarlos. La fila de la
 * cuenta se bloquea, como al solicitar: dos envíos a la vez no guardan dos veces los documentos.
 */
@Injectable()
export class DocumentosVerificacionService {
  private readonly logger = new Logger(DocumentosVerificacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacen: AlmacenArchivos,
  ) {}

  async adjuntar(
    codigoPublico: string,
    dto: AdjuntarDocumentosDto,
    archivos: ArchivoAntecedente[] | undefined,
  ): Promise<SolicitudVerificacionCuenta> {
    const documentos = revisarDocumentos(archivos ?? [], dto.tipos);

    // Revisión previa para no subir archivos que no se van a poder registrar
    const previa = await this.prisma.solicitudVerificacion.findFirst({
      where: { solicitante: { codigoPublico } },
      orderBy: { id: 'desc' },
      select: { id: true, estado: true, solicitanteId: true },
    });
    if (!previa) throw new NotFoundException(SIN_SOLICITUD);
    exigirPendiente(previa.estado);

    const guardados = await this.guardarArchivos(
      previa.solicitanteId,
      documentos,
    );
    try {
      return await this.prisma.$transaction(async (tx) => {
        await bloquearCuenta(tx, codigoPublico);
        const actual = await tx.solicitudVerificacion.findUniqueOrThrow({
          where: { id: previa.id },
          select: { estado: true },
        });
        exigirPendiente(actual.estado);

        const solicitud = await tx.solicitudVerificacion.update({
          where: { id: previa.id },
          data: {
            estado: ESTADOS_SOLICITUD.REVISION_MANUAL,
            antecedentes: {
              create: guardados.map((documento) => ({
                tipo: documento.tipo,
                nombreArchivo: documento.nombreArchivo,
                ubicacionArchivo: documento.clave,
                hashArchivo: createHash('sha256')
                  .update(documento.contenido)
                  .digest('hex'),
                estadoOcr: ESTADOS_OCR.NO_APLICA,
              })),
            },
          },
          select: SELECCION_SOLICITUD,
        });
        return aSolicitudCuenta(solicitud);
      });
    } catch (error) {
      await Promise.all(
        guardados.map((documento) => this.borrarArchivo(documento.clave)),
      );
      throw error;
    }
  }

  /** Sube los documentos uno a uno; si uno falla, borra los que ya subió. */
  private async guardarArchivos(
    cuentaId: number,
    documentos: DocumentoRevisado[],
  ): Promise<DocumentoGuardado[]> {
    const guardados: DocumentoGuardado[] = [];
    try {
      for (const documento of documentos) {
        const clave = `verificaciones/${cuentaId}/${randomUUID()}.${documento.formato.extension}`;
        // Privado: son datos personales, no se entregan con URL pública
        await this.almacen.guardar(
          clave,
          documento.contenido,
          documento.formato.tipoContenido,
          true,
        );
        guardados.push({ ...documento, clave });
      }
      return guardados;
    } catch (error) {
      await Promise.all(
        guardados.map((documento) => this.borrarArchivo(documento.clave)),
      );
      if (error instanceof HttpException) throw error;
      this.logger.warn(
        `No se pudo guardar un documento de la cuenta ${cuentaId} en el almacén: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'No se pudieron guardar los documentos. Intenta de nuevo en unos minutos.',
      );
    }
  }

  /** Borra un archivo que no llegó a registrarse; si tampoco se puede, queda en el registro. */
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

/** Solo se adjuntan documentos a la solicitud que los está esperando. */
const exigirPendiente = (estado: string) => {
  if (estado === ESTADOS_SOLICITUD.PENDIENTE) return;
  if (estado === ESTADOS_SOLICITUD.APROBADA) {
    throw new ConflictException(YA_APROBADA);
  }
  if (estado === ESTADOS_SOLICITUD.REVISION_MANUAL) {
    throw new ConflictException(DOCUMENTOS_YA_ENVIADOS);
  }
  throw new ConflictException(SOLICITUD_RECHAZADA);
};

/** Revisa cantidad, tamaño y formato real de cada archivo, y que cada uno traiga su tipo. */
const revisarDocumentos = (
  archivos: ArchivoAntecedente[],
  tipos: string[],
): DocumentoRevisado[] => {
  if (archivos.length < 1 || archivos.length > MAXIMO_ANTECEDENTES) {
    throw errorDeCampo(BadRequestException, SIN_ARCHIVOS, 'archivos');
  }
  if (tipos.length !== archivos.length) {
    throw errorDeCampo(BadRequestException, TIPOS_NO_COINCIDEN, 'tipos');
  }
  return archivos.map((archivo, indice) => {
    if (archivo.size > TAMANO_MAXIMO_ANTECEDENTE_BYTES) {
      throw errorDeCampo(BadRequestException, DOCUMENTO_MUY_GRANDE, 'archivos');
    }
    const formato = detectarTipoAntecedente(archivo.buffer);
    if (!formato)
      throw errorDeCampo(
        BadRequestException,
        documentoNoValido(indice + 1),
        'archivos',
      );
    return {
      contenido: archivo.buffer,
      tipo: tipos[indice],
      nombreArchivo: nombreSeguro(archivo.originalname, formato, indice),
      formato,
    };
  });
};

/**
 * El nombre que el navegador declara, sin ruta ni caracteres de control y a lo más de 255
 * caracteres (el largo de la columna). Multer lo entrega leído como latin1: se vuelve a leer como
 * UTF-8, así «título.pdf» no llega como «tÃ­tulo.pdf».
 */
const nombreSeguro = (
  declarado: string,
  formato: TipoArchivoAntecedente,
  indice: number,
): string => {
  const sinRuta = Buffer.from(declarado, 'latin1')
    .toString('utf8')
    .split(/[\\/]/)
    .pop();
  const limpio = (sinRuta ?? '')
    .replace(/\p{Cc}/gu, '')
    .trim()
    .slice(0, 255);
  return limpio === ''
    ? `documento-${indice + 1}.${formato.extension}`
    : limpio;
};
