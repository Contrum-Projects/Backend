import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { AlmacenArchivos } from '../../almacen/almacen-archivos.js';
import { hoyEnLaTienda } from '../../common/dominio/fechas.js';
import {
  ESTADOS_SOLICITUD,
  RESULTADOS_CONSULTA_SII,
} from '../../common/dominio/valores.js';
import {
  POR_PAGINA,
  type Paginacion,
} from '../../common/validacion/paginacion.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SIN_SOLICITUD_CUENTA } from './revision-verificacion.service.js';
import type { ActividadSii } from './sii/proveedor-situacion-tributaria.js';

/**
 * Cuánto sirve el enlace a un documento: lo justo para abrirlo; después se pide otro. El enlace se
 * abre sin sesión, así que el equipo pidió un plazo corto (3 nov).
 */
export const SEGUNDOS_ENLACE_DOCUMENTO = 60;

export const DOCUMENTO_NO_EXISTE = 'La solicitud no tiene ese documento.';
export const documentoEliminado = (fecha: Date) => {
  const [anio, mes, dia] = hoyEnLaTienda(fecha).split('-');
  return `El documento se eliminó el ${dia}-${mes}-${anio}.`;
};

/** Por qué una solicitud no se aprobó sola: lo que dio la consulta al SII. */
type MotivoRevision = Exclude<
  (typeof RESULTADOS_CONSULTA_SII)[keyof typeof RESULTADOS_CONSULTA_SII],
  typeof RESULTADOS_CONSULTA_SII.APROBADO
>;

/** Una solicitud esperando al personal, en el listado (E10-H7). */
export interface SolicitudEnRevision {
  /** `codigoPublico` de la cuenta que solicitó: con él se abre el detalle y se resuelve. */
  codigoPublicoCuenta: string;
  nombre: string;
  apellido: string;
  rut: string | null;
  /** Cuándo se creó la solicitud. */
  fechaEnvio: string;
  motivoRevision: MotivoRevision | null;
}

export interface ListadoSolicitudesEnRevision {
  items: SolicitudEnRevision[];
  total: number;
  pagina: number;
  limite: number;
}

export interface PersonaResolutora {
  codigoPublico: string;
  nombre: string;
  apellido: string;
}

/** Una solicitud de la cuenta con su resolución (E10-H7). */
export interface ResumenSolicitud {
  estado: string;
  fechaSolicitud: string;
  fechaResolucion: string | null;
  /** Solo si fue rechazada. */
  motivoRechazo: string | null;
  resolutor: PersonaResolutora | null;
}

export interface DocumentoDeSolicitud {
  /** Su posición en la solicitud (desde 1): con ella se pide el enlace. */
  numero: number;
  tipo: string;
  nombreArchivo: string;
  /** Si ya se borró el archivo (E10-H6), cuándo; entonces no hay enlace. */
  fechaEliminacion: string | null;
}

export interface DetalleSolicitud extends ResumenSolicitud {
  motivoRevision: MotivoRevision | null;
  /** `null` si la solicitud nunca se consultó al SII. */
  consultaSii: {
    fecha: string;
    resultado: string;
    /** Los giros que informó el SII; `null` si la consulta falló (`no_disponible`). */
    giros: ActividadSii[] | null;
  } | null;
  documentos: DocumentoDeSolicitud[];
}

export interface DetalleVerificacion {
  cliente: {
    codigoPublico: string;
    nombre: string;
    apellido: string;
    rut: string | null;
    email: string;
    telefono: string | null;
  };
  /** La solicitud más reciente de la cuenta. */
  solicitud: DetalleSolicitud;
  /** Las anteriores, de la más reciente a la más antigua. */
  solicitudesAnteriores: ResumenSolicitud[];
}

export interface EnlaceDocumento {
  url: string;
  /** Hasta cuándo sirve el enlace. */
  venceEn: string;
  tipo: string;
  nombreArchivo: string;
}

const motivoDeRevision = (resultado: string | null): MotivoRevision | null =>
  resultado === null || resultado === RESULTADOS_CONSULTA_SII.APROBADO
    ? null
    : (resultado as MotivoRevision);

const aGiros = (valor: unknown): ActividadSii[] | null =>
  Array.isArray(valor) ? (valor as ActividadSii[]) : null;

/**
 * Consulta de las solicitudes de verificación por el personal (E10-H7, RF-10.06): el listado de
 * las que esperan revisión manual, el detalle de una cuenta con sus documentos y el enlace
 * temporal a cada documento. Solo lee: resolverlas es de E10-H3.
 *
 * Los documentos están en el almacén como privados; nunca se entrega su ubicación, solo un enlace
 * firmado que vence. Como en E10-H3, la cuenta se identifica por su `codigoPublico` y se trabaja
 * con su solicitud más reciente.
 */
@Injectable()
export class ConsultaVerificacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly almacen: AlmacenArchivos,
  ) {}

  /** E10-H7 · Las solicitudes en revisión manual, de la más antigua a la más reciente. */
  async listar(paginacion: Paginacion): Promise<ListadoSolicitudesEnRevision> {
    const pagina = paginacion.pagina ?? 1;
    const limite = paginacion.limite ?? POR_PAGINA;
    const where = { estado: ESTADOS_SOLICITUD.REVISION_MANUAL };

    const [total, filas] = await Promise.all([
      this.prisma.solicitudVerificacion.count({ where }),
      this.prisma.solicitudVerificacion.findMany({
        where,
        select: {
          fechaSolicitud: true,
          resultadoConsultaSii: true,
          solicitante: {
            select: {
              codigoPublico: true,
              nombre: true,
              apellido: true,
              rut: true,
            },
          },
        },
        orderBy: [{ fechaSolicitud: 'asc' }, { id: 'asc' }],
        skip: (pagina - 1) * limite,
        take: limite,
      }),
    ]);

    return {
      items: filas.map((fila) => ({
        codigoPublicoCuenta: fila.solicitante.codigoPublico,
        nombre: fila.solicitante.nombre,
        apellido: fila.solicitante.apellido,
        rut: fila.solicitante.rut,
        fechaEnvio: fila.fechaSolicitud.toISOString(),
        motivoRevision: motivoDeRevision(fila.resultadoConsultaSii),
      })),
      total,
      pagina,
      limite,
    };
  }

  /**
   * E10-H7 · El detalle de la cuenta: sus datos, su solicitud más reciente con lo que dijo el SII
   * y sus documentos, y las solicitudes anteriores con su resolución. Sirve en cualquier estado,
   * también para ver una solicitud ya resuelta.
   */
  async detalle(codigoPublicoCuenta: string): Promise<DetalleVerificacion> {
    const cliente = await this.prisma.usuario.findUnique({
      where: { codigoPublico: codigoPublicoCuenta },
      select: {
        codigoPublico: true,
        nombre: true,
        apellido: true,
        rut: true,
        email: true,
        telefono: true,
        solicitudesPresentadas: {
          orderBy: { id: 'desc' },
          select: {
            estado: true,
            fechaSolicitud: true,
            fechaResolucion: true,
            motivoRechazo: true,
            fechaConsultaSii: true,
            resultadoConsultaSii: true,
            girosSii: true,
            resolutor: {
              select: { codigoPublico: true, nombre: true, apellido: true },
            },
            antecedentes: {
              orderBy: { id: 'asc' },
              select: {
                tipo: true,
                nombreArchivo: true,
                fechaEliminacionArchivo: true,
              },
            },
          },
        },
      },
    });
    const [actual, ...anteriores] = cliente?.solicitudesPresentadas ?? [];
    if (!cliente || !actual) throw new NotFoundException(SIN_SOLICITUD_CUENTA);

    const { solicitudesPresentadas: _solicitudes, ...datosCliente } = cliente;
    return {
      cliente: datosCliente,
      solicitud: {
        ...resumir(actual),
        motivoRevision: motivoDeRevision(actual.resultadoConsultaSii),
        consultaSii:
          actual.fechaConsultaSii && actual.resultadoConsultaSii
            ? {
                fecha: actual.fechaConsultaSii.toISOString(),
                resultado: actual.resultadoConsultaSii,
                giros: aGiros(actual.girosSii),
              }
            : null,
        documentos: actual.antecedentes.map((documento, indice) => ({
          numero: indice + 1,
          tipo: documento.tipo,
          nombreArchivo: documento.nombreArchivo,
          fechaEliminacion:
            documento.fechaEliminacionArchivo?.toISOString() ?? null,
        })),
      },
      solicitudesAnteriores: anteriores.map(resumir),
    };
  }

  /**
   * E10-H7 · Enlace temporal para ver o descargar un documento de la solicitud más reciente de la
   * cuenta. Si el archivo ya se eliminó (E10-H6) responde 410 con la fecha, sin enlace.
   */
  async enlaceDocumento(
    codigoPublicoCuenta: string,
    numero: number,
  ): Promise<EnlaceDocumento> {
    const solicitud = await this.prisma.solicitudVerificacion.findFirst({
      where: { solicitante: { codigoPublico: codigoPublicoCuenta } },
      orderBy: { id: 'desc' },
      select: {
        antecedentes: {
          orderBy: { id: 'asc' },
          select: {
            tipo: true,
            nombreArchivo: true,
            ubicacionArchivo: true,
            fechaEliminacionArchivo: true,
          },
        },
      },
    });
    if (!solicitud) throw new NotFoundException(SIN_SOLICITUD_CUENTA);
    const documento = solicitud.antecedentes[numero - 1];
    if (!documento) throw new NotFoundException(DOCUMENTO_NO_EXISTE);
    if (documento.fechaEliminacionArchivo) {
      throw new GoneException(
        documentoEliminado(documento.fechaEliminacionArchivo),
      );
    }

    const url = await this.almacen.urlTemporal(documento.ubicacionArchivo, {
      segundos: SEGUNDOS_ENLACE_DOCUMENTO,
      nombreArchivo: documento.nombreArchivo,
    });
    return {
      url,
      venceEn: new Date(
        Date.now() + SEGUNDOS_ENLACE_DOCUMENTO * 1000,
      ).toISOString(),
      tipo: documento.tipo,
      nombreArchivo: documento.nombreArchivo,
    };
  }
}

const resumir = (solicitud: {
  estado: string;
  fechaSolicitud: Date;
  fechaResolucion: Date | null;
  motivoRechazo: string | null;
  resolutor: PersonaResolutora | null;
}): ResumenSolicitud => ({
  estado: solicitud.estado,
  fechaSolicitud: solicitud.fechaSolicitud.toISOString(),
  fechaResolucion: solicitud.fechaResolucion?.toISOString() ?? null,
  motivoRechazo:
    solicitud.estado === ESTADOS_SOLICITUD.RECHAZADA
      ? solicitud.motivoRechazo
      : null,
  resolutor: solicitud.resolutor,
});
