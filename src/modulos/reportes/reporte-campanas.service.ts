import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_CAMPANA,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import { porcentaje } from '../../common/dominio/porcentajes.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  leerSegmento,
  type SegmentoCampana,
} from '../marketing/segmento-campana.js';
import { validarPeriodo } from './periodo-reporte.js';

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

/**
 * Una fila de «Resultados de campañas» (E14-H3, SCRUM-144; SCRUM-150): una campaña enviada en el
 * período, o el saludo de cumpleaños de un mes. Los porcentajes los calcula el backend (RNF-03)
 * sobre los correos `enviada`; `null` si no salió ninguno.
 */
export interface FilaReporteCampana {
  /** Id de la campaña (decisión del 6 nov: las campañas se identifican por id). `null` en el saludo por defecto, que no tiene fila. */
  id: number | null;
  /** Asunto de la campaña, o «Saludo de cumpleaños». */
  nombre: string;
  /** El saludo de cumpleaños: sus correos del mes, en una fila. */
  automatica: boolean;
  /** Campaña: cuándo se confirmó el envío (ISO 8601). Automática: el mes (AAAA-MM, hora de Chile). */
  fecha: string;
  /** Segmento con que salió la campaña; `null` en el saludo de cumpleaños. */
  segmento: SegmentoCampana | null;
  enviados: number;
  porcentajeAbiertos: number | null;
  porcentajeClic: number | null;
  rebotados: number;
  cancelados: number;
  fallidos: number;
}

export interface ReportePeriodoCampanas {
  desde: string;
  hasta: string;
  /** Las más recientes primero. */
  campanas: FilaReporteCampana[];
}

/** Nombre de la fila del saludo de cumpleaños en el reporte. */
export const NOMBRE_SALUDO_CUMPLEANOS = 'Saludo de cumpleaños';

/** Conteos de los correos de una fila del reporte por período. */
type ConteosPeriodo = {
  enviados: bigint;
  abiertos: bigint;
  clics: bigint;
  rebotados: bigint;
  cancelados: bigint;
  fallidos: bigint;
};

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

  /**
   * E14-H3 · Resultados de campañas por período (SCRUM-150): las campañas de envío único
   * confirmadas entre `desde` y `hasta` (ambos incluidos, hora de Chile) y una fila por mes con el
   * saludo de cumpleaños de ese mes, las más recientes primero.
   */
  async periodo(desde: string, hasta: string): Promise<ReportePeriodoCampanas> {
    validarPeriodo(desde, hasta);
    const inicio = Prisma.sql`(${desde}::date)::timestamp AT TIME ZONE 'America/Santiago'`;
    const fin = Prisma.sql`(${hasta}::date + 1)::timestamp AT TIME ZONE 'America/Santiago'`;
    const enviada = ESTADOS_NOTIFICACION.ENVIADA;
    const conteos = Prisma.sql`
      COUNT(n.id_notificacion) FILTER (WHERE n.estado_envio = ${enviada}) AS "enviados",
      COUNT(n.id_notificacion) FILTER (WHERE n.estado_envio = ${enviada} AND n.fecha_apertura IS NOT NULL) AS "abiertos",
      COUNT(n.id_notificacion) FILTER (WHERE n.estado_envio = ${enviada} AND n.fecha_clic IS NOT NULL) AS "clics",
      COUNT(n.id_notificacion) FILTER (WHERE n.estado_envio = ${ESTADOS_NOTIFICACION.REBOTADA}) AS "rebotados",
      COUNT(n.id_notificacion) FILTER (WHERE n.estado_envio = ${ESTADOS_NOTIFICACION.CANCELADA}) AS "cancelados",
      COUNT(n.id_notificacion) FILTER (WHERE n.estado_envio = ${ESTADOS_NOTIFICACION.FALLIDA}) AS "fallidos"`;

    const [campanas, meses, saludo] = await Promise.all([
      this.prisma.$queryRaw<
        (ConteosPeriodo & {
          id: number;
          asunto: string;
          segmento: string | null;
          fechaEnvio: Date;
        })[]
      >`
        SELECT c.id_campana AS "id", c.asunto, c.segmento, c.fecha_encolado AS "fechaEnvio",
               ${conteos}
        FROM campana c
        LEFT JOIN notificacion n ON n.id_campana = c.id_campana
        WHERE c.tipo = ${TIPOS_CAMPANA.ENVIO_UNICO}
          AND c.fecha_encolado >= ${inicio}
          AND c.fecha_encolado < ${fin}
        GROUP BY c.id_campana
        ORDER BY c.fecha_encolado DESC, c.id_campana DESC`,
      this.prisma.$queryRaw<(ConteosPeriodo & { mes: string })[]>`
        SELECT to_char(n.fecha_creacion AT TIME ZONE 'America/Santiago', 'YYYY-MM') AS "mes",
               ${conteos}
        FROM notificacion n
        WHERE n.tipo = ${TIPOS_NOTIFICACION.CUMPLEANOS}
          AND n.fecha_creacion >= ${inicio}
          AND n.fecha_creacion < ${fin}
        GROUP BY 1
        ORDER BY 1 DESC`,
      this.prisma.campana.findFirst({
        where: { tipo: TIPOS_CAMPANA.CUMPLEANOS },
        orderBy: { id: 'asc' },
        select: { id: true },
      }),
    ]);

    const filas: { orden: string; fila: FilaReporteCampana }[] = [
      ...campanas.map((campana) => ({
        orden: campana.fechaEnvio.toISOString(),
        fila: {
          id: campana.id,
          nombre: campana.asunto,
          automatica: false,
          fecha: campana.fechaEnvio.toISOString(),
          segmento: leerSegmento(campana.segmento),
          ...cifrasDe(campana),
        },
      })),
      ...meses.map((mes) => ({
        // El mes se ordena como su primer día
        orden: `${mes.mes}-01`,
        fila: {
          id: saludo?.id ?? null,
          nombre: NOMBRE_SALUDO_CUMPLEANOS,
          automatica: true,
          fecha: mes.mes,
          segmento: null,
          ...cifrasDe(mes),
        },
      })),
    ];
    filas.sort((a, b) => (a.orden < b.orden ? 1 : a.orden > b.orden ? -1 : 0));
    return { desde, hasta, campanas: filas.map(({ fila }) => fila) };
  }
}

/** Conteos de una fila del reporte, con los porcentajes sobre los correos enviados. */
const cifrasDe = (conteos: ConteosPeriodo) => {
  const enviados = Number(conteos.enviados);
  return {
    enviados,
    porcentajeAbiertos: porcentaje(Number(conteos.abiertos), enviados),
    porcentajeClic: porcentaje(Number(conteos.clics), enviados),
    rebotados: Number(conteos.rebotados),
    cancelados: Number(conteos.cancelados),
    fallidos: Number(conteos.fallidos),
  };
};
