import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_CAMPANA,
} from '../../common/dominio/valores.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Correos de la campaña. Los estados no se solapan (cada correo está en uno); `abiertos` y
 * `clics` cuentan los correos con apertura o clic registrados (E12-H6), en cualquier estado.
 */
export interface ResultadoEnvios {
  total: number;
  pendientes: number;
  enviados: number;
  abiertos: number;
  clics: number;
  rebotados: number;
  cancelados: number;
  fallidos: number;
}

export interface ResultadoCampana {
  id: number;
  tipo: string;
  asunto: string;
  /** Cuándo se confirmó el envío; el saludo de cumpleaños sale todos los días y no tiene. */
  fechaEnvio: Date | null;
  envios: ResultadoEnvios;
}

/** Fila de la consulta: PostgreSQL devuelve COUNT como bigint. */
type FilaConteo = { [Clave in keyof ResultadoEnvios]: bigint };

@Injectable()
export class ReporteCampanasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * E14-H3 · Resultado de una campaña (RF-14.05): sus correos enviados, abiertos, con clic,
   * rebotados, cancelados y fallidos, más los pendientes y el total. Sirve para las campañas de
   * envío único y para el saludo de cumpleaños. Un borrador aún no tiene resultado (409).
   */
  async resultado(id: number): Promise<ResultadoCampana> {
    const campana = await this.prisma.campana.findUnique({
      where: { id },
      select: { id: true, tipo: true, asunto: true, fechaEncolado: true },
    });
    if (!campana) throw new NotFoundException('La campaña no existe.');
    if (
      campana.tipo === TIPOS_CAMPANA.ENVIO_UNICO &&
      campana.fechaEncolado === null
    ) {
      throw new ConflictException(
        'La campaña aún no se envía: no tiene resultados.',
      );
    }

    const [fila] = await this.prisma.$queryRaw<FilaConteo[]>`
      SELECT COUNT(*) AS "total",
             COUNT(*) FILTER (WHERE estado_envio = ${ESTADOS_NOTIFICACION.PENDIENTE}) AS "pendientes",
             COUNT(*) FILTER (WHERE estado_envio = ${ESTADOS_NOTIFICACION.ENVIADA}) AS "enviados",
             COUNT(fecha_apertura) AS "abiertos",
             COUNT(fecha_clic) AS "clics",
             COUNT(*) FILTER (WHERE estado_envio = ${ESTADOS_NOTIFICACION.REBOTADA}) AS "rebotados",
             COUNT(*) FILTER (WHERE estado_envio = ${ESTADOS_NOTIFICACION.CANCELADA}) AS "cancelados",
             COUNT(*) FILTER (WHERE estado_envio = ${ESTADOS_NOTIFICACION.FALLIDA}) AS "fallidos"
      FROM notificacion
      WHERE id_campana = ${id}`;

    return {
      id: campana.id,
      tipo: campana.tipo,
      asunto: campana.asunto,
      fechaEnvio: campana.fechaEncolado,
      envios: {
        total: Number(fila?.total ?? 0n),
        pendientes: Number(fila?.pendientes ?? 0n),
        enviados: Number(fila?.enviados ?? 0n),
        abiertos: Number(fila?.abiertos ?? 0n),
        clics: Number(fila?.clics ?? 0n),
        rebotados: Number(fila?.rebotados ?? 0n),
        cancelados: Number(fila?.cancelados ?? 0n),
        fallidos: Number(fila?.fallidos ?? 0n),
      },
    };
  }
}
