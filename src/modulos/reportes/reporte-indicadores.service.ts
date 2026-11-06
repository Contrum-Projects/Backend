import { Injectable } from '@nestjs/common';
import {
  ESTADOS_SIN_VENTA,
  ESTADOS_SOLICITUD,
  ORIGENES_DESCRIPCION,
} from '../../common/dominio/valores.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { validarPeriodo } from './periodo-reporte.js';

/** Objetivos específicos del proyecto y su meta en porcentaje (E14-H1, RF-14.01 a RF-14.03). */
export const OBJETIVOS = {
  OE1: { nombre: 'Profesionales verificados que compran', meta: 30 },
  OE2: { nombre: 'Solicitudes resueltas en 48 horas', meta: 70 },
  OE3: { nombre: 'Descripciones hechas con IA', meta: 80 },
} as const;

export type CodigoObjetivo = keyof typeof OBJETIVOS;

/** Plazo del OE2 (RF-14.02): una solicitud cumple si se resolvió en 48 horas o menos. */
export const PLAZO_RESOLUCION_HORAS = 48;

/** Las descripciones que cuentan como hechas con IA (decisión del 5 nov 2026): aceptada o corregida. */
export const ORIGENES_CON_IA: readonly string[] = [
  ORIGENES_DESCRIPCION.IA,
  ORIGENES_DESCRIPCION.IA_EDITADA,
];

const ESTADOS_RESUELTA: readonly string[] = [
  ESTADOS_SOLICITUD.APROBADA,
  ESTADOS_SOLICITUD.RECHAZADA,
];

export interface Indicador {
  codigo: CodigoObjetivo;
  nombre: string;
  /** Meta del objetivo, en porcentaje. */
  meta: number;
  /** Con un decimal; `null` si en el período no hay nada que medir (CA2). */
  porcentaje: number | null;
  /** Lo que cumple el objetivo, de `total`. */
  cumplidos: number;
  total: number;
  sinDatos: boolean;
}

export interface ReporteIndicadores {
  desde: string;
  hasta: string;
  indicadores: Indicador[];
}

/** Fila de cada consulta: PostgreSQL devuelve COUNT como bigint. */
interface Conteo {
  total: bigint;
  cumplidos: bigint;
}

/** El indicador de un objetivo a partir de su conteo. Sin total no hay porcentaje (CA2). */
export const aIndicador = (
  codigo: CodigoObjetivo,
  conteo: Conteo | undefined,
): Indicador => {
  const total = Number(conteo?.total ?? 0);
  const cumplidos = Number(conteo?.cumplidos ?? 0);
  const { nombre, meta } = OBJETIVOS[codigo];
  return {
    codigo,
    nombre,
    meta,
    porcentaje:
      total === 0 ? null : Math.round((cumplidos * 1000) / total) / 10,
    cumplidos,
    total,
    sinDatos: total === 0,
  };
};

/**
 * E14-H1 · Indicadores de los objetivos del proyecto en un período (decisiones del 5 nov 2026).
 * Cada uno se calcula al consultar con una consulta agregada, sin caché. Los días se cortan a
 * medianoche de Chile, como el reporte de ventas.
 *
 * - **OE1:** de las cuentas cuya verificación se aprobó en el período, cuántas tienen al menos un
 *   pedido pagado desde que se aprobó hasta el fin del período.
 * - **OE2:** de las solicitudes presentadas en el período, cuántas se aprobaron o rechazaron en 48
 *   horas o menos desde que se presentaron (una aprobada sola por el SII, al instante). Una sin
 *   resolver que todavía está dentro de sus 48 horas aún no se puede medir y queda fuera; una sin
 *   resolver con más de 48 horas cuenta y no cumple.
 * - **OE3:** de los productos creados en el período, cuántos tienen la descripción de la IA,
 *   aceptada tal cual o corregida. Cuentan también los que después se desactivaron: OE3 mide cómo
 *   se hizo la descripción al crearlo.
 */
@Injectable()
export class ReporteIndicadoresService {
  constructor(private readonly prisma: PrismaService) {}

  async indicadores(
    desde: string,
    hasta: string,
    ahora: Date = new Date(),
  ): Promise<ReporteIndicadores> {
    validarPeriodo(desde, hasta);

    const [oe1, oe2, oe3] = await Promise.all([
      this.profesionalesQueCompran(desde, hasta),
      this.solicitudesEnPlazo(desde, hasta, ahora),
      this.descripcionesConIa(desde, hasta),
    ]);
    return {
      desde,
      hasta,
      indicadores: [
        aIndicador('OE1', oe1),
        aIndicador('OE2', oe2),
        aIndicador('OE3', oe3),
      ],
    };
  }

  private async profesionalesQueCompran(
    desde: string,
    hasta: string,
  ): Promise<Conteo | undefined> {
    const [fila] = await this.prisma.$queryRaw<Conteo[]>`
      WITH aprobadas AS (
        SELECT s.id_usuario_solicitante AS id_usuario,
               MIN(s.fecha_resolucion) AS fecha_aprobacion
        FROM solicitud_verificacion s
        WHERE s.estado = ${ESTADOS_SOLICITUD.APROBADA}
          AND s.fecha_resolucion >= (${desde}::date)::timestamp AT TIME ZONE 'America/Santiago'
          AND s.fecha_resolucion < (${hasta}::date + 1)::timestamp AT TIME ZONE 'America/Santiago'
        GROUP BY s.id_usuario_solicitante
      )
      SELECT COUNT(*) AS "total",
             COUNT(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM pedido p
               WHERE p.id_usuario = a.id_usuario
                 AND p.fecha_pedido >= a.fecha_aprobacion
                 AND p.fecha_pedido < (${hasta}::date + 1)::timestamp AT TIME ZONE 'America/Santiago'
                 AND p.estado_actual <> ALL(${ESTADOS_SIN_VENTA}::text[])
             )) AS "cumplidos"
      FROM aprobadas a`;
    return fila;
  }

  private async solicitudesEnPlazo(
    desde: string,
    hasta: string,
    ahora: Date,
  ): Promise<Conteo | undefined> {
    const [fila] = await this.prisma.$queryRaw<Conteo[]>`
      SELECT COUNT(*) FILTER (
               WHERE s.estado = ANY(${ESTADOS_RESUELTA}::text[])
                  OR s.fecha_solicitud <= ${ahora}::timestamptz - make_interval(hours => ${PLAZO_RESOLUCION_HORAS})
             ) AS "total",
             COUNT(*) FILTER (
               WHERE s.estado = ANY(${ESTADOS_RESUELTA}::text[])
                 AND s.fecha_resolucion - s.fecha_solicitud <= make_interval(hours => ${PLAZO_RESOLUCION_HORAS})
             ) AS "cumplidos"
      FROM solicitud_verificacion s
      WHERE s.fecha_solicitud >= (${desde}::date)::timestamp AT TIME ZONE 'America/Santiago'
        AND s.fecha_solicitud < (${hasta}::date + 1)::timestamp AT TIME ZONE 'America/Santiago'`;
    return fila;
  }

  private async descripcionesConIa(
    desde: string,
    hasta: string,
  ): Promise<Conteo | undefined> {
    const [fila] = await this.prisma.$queryRaw<Conteo[]>`
      SELECT COUNT(*) AS "total",
             COUNT(*) FILTER (
               WHERE p.origen_descripcion = ANY(${ORIGENES_CON_IA}::text[])
             ) AS "cumplidos"
      FROM producto p
      WHERE p.fecha_creacion >= (${desde}::date)::timestamp AT TIME ZONE 'America/Santiago'
        AND p.fecha_creacion < (${hasta}::date + 1)::timestamp AT TIME ZONE 'America/Santiago'`;
    return fila;
  }
}
