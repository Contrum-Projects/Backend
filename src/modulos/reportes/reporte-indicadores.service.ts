import { Injectable } from '@nestjs/common';
import {
  ESTADOS_OBJETIVO,
  ESTADOS_SIN_VENTA,
  GRUPOS_MOVIMIENTO,
  TIPOS_POR_GRUPO_MOVIMIENTO,
  type Valor,
} from '../../common/dominio/valores.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { validarPeriodo } from './periodo-reporte.js';

/**
 * Objetivos específicos del proyecto y su meta en porcentaje (E14-H1, decisión del 18 nov 2026).
 * `forma` dice cómo se compara con la meta:
 * - `crecimiento`: el período contra el anterior de igual largo debe subir al menos la meta.
 * - `reduccion`: el período contra el anterior debe bajar al menos la meta.
 * - `proporcion`: `cumplidos / total` debe alcanzar la meta.
 */
export const OBJETIVOS = {
  OE1: { nombre: 'Facturación digital', meta: 20, forma: 'crecimiento' },
  OE2: { nombre: 'Quiebres de stock', meta: 80, forma: 'reduccion' },
  OE3: { nombre: 'Alcance territorial', meta: 30, forma: 'proporcion' },
} as const;

export type CodigoObjetivo = keyof typeof OBJETIVOS;

/**
 * Talcahuano y sus comunas aledañas, por código CUT (OE3, decisión del 18 nov 2026): Concepción,
 * Chiguayante, Penco, San Pedro de la Paz, Talcahuano y Hualpén.
 */
export const COMUNAS_LOCALES: readonly string[] = [
  '08101',
  '08103',
  '08107',
  '08108',
  '08110',
  '08112',
];

/** Tipos de movimiento que suman stock y los que lo restan; la transferencia no lo cambia (OE2). */
const TIPOS_QUE_SUMAN: readonly string[] =
  TIPOS_POR_GRUPO_MOVIMIENTO[GRUPOS_MOVIMIENTO.ENTRADAS];
const TIPOS_QUE_RESTAN: readonly string[] = [
  ...TIPOS_POR_GRUPO_MOVIMIENTO[GRUPOS_MOVIMIENTO.VENTAS],
  ...TIPOS_POR_GRUPO_MOVIMIENTO[GRUPOS_MOVIMIENTO.SALIDAS],
];

export interface Indicador {
  codigo: CodigoObjetivo;
  nombre: string;
  /** Meta del objetivo, en porcentaje. */
  meta: number;
  /** Con un decimal; `null` si no hay con qué medir (CA2). En OE1 y OE2 puede ser negativo. */
  porcentaje: number | null;
  /**
   * OE1: pesos vendidos en el período. OE2: quiebres en el período. OE3: pedidos despachados fuera
   * de la zona local.
   */
  cumplidos: number;
  /**
   * OE1: pesos vendidos en el período anterior. OE2: quiebres en el período anterior. OE3: todos
   * los pedidos pagados del período.
   */
  total: number;
  sinDatos: boolean;
  /** Frente a la meta: alcanzarla cuenta como sobre la meta (SCRUM-150). */
  estado: Valor<typeof ESTADOS_OBJETIVO>;
}

export interface ReporteIndicadores {
  desde: string;
  hasta: string;
  indicadores: Indicador[];
}

/** Fila de cada consulta: PostgreSQL devuelve COUNT y SUM de enteros como bigint. */
interface Conteo {
  total: bigint;
  cumplidos: bigint;
}

const conUnDecimal = (parte: number, base: number) =>
  Math.round((parte * 1000) / base) / 10;

/**
 * El indicador de un objetivo a partir de su conteo. Sin `total` no hay porcentaje (CA2): en OE1 y
 * OE2 es el período anterior, sin el cual no hay con qué comparar.
 */
export const aIndicador = (
  codigo: CodigoObjetivo,
  conteo: Conteo | undefined,
): Indicador => {
  const total = Number(conteo?.total ?? 0);
  const cumplidos = Number(conteo?.cumplidos ?? 0);
  const { nombre, meta, forma } = OBJETIVOS[codigo];
  const base = { codigo, nombre, meta, cumplidos, total };
  if (total === 0) {
    return {
      ...base,
      porcentaje: null,
      sinDatos: true,
      estado: ESTADOS_OBJETIVO.SIN_DATOS,
    };
  }
  // Lo que se compara con la meta, sobre `total`
  const avance =
    forma === 'crecimiento'
      ? cumplidos - total
      : forma === 'reduccion'
        ? total - cumplidos
        : cumplidos;
  return {
    ...base,
    porcentaje: conUnDecimal(avance, total),
    sinDatos: false,
    // Con los conteos y no con el porcentaje redondeado: 29,96 % no alcanza una meta de 30
    estado:
      avance * 100 >= meta * total
        ? ESTADOS_OBJETIVO.SOBRE_LA_META
        : ESTADOS_OBJETIVO.BAJO_LA_META,
  };
};

/**
 * E14-H1 · Indicadores de los objetivos del proyecto en un período (decisiones del 18 nov 2026).
 * Cada uno se calcula al consultar con una consulta agregada, sin caché. Los días se cortan a
 * medianoche de Chile, como el reporte de ventas. El **período anterior** tiene los mismos días y
 * termina justo antes de `desde`.
 *
 * - **OE1 Facturación digital:** cuánto crece el monto total de los pedidos pagados del período
 *   frente al anterior. Meta: +20 %.
 * - **OE2 Quiebres de stock:** cuánto bajan los quiebres frente al período anterior. Un quiebre es
 *   un movimiento que deja en 0 (o menos) el stock total de un formato que tenía stock. Meta: -80 %.
 * - **OE3 Alcance territorial:** de los pedidos pagados del período, cuántos se despachan fuera de
 *   Talcahuano y sus comunas aledañas (`COMUNAS_LOCALES`); el retiro en tienda cuenta como local.
 *   Meta: 30 %.
 */
@Injectable()
export class ReporteIndicadoresService {
  constructor(private readonly prisma: PrismaService) {}

  async indicadores(desde: string, hasta: string): Promise<ReporteIndicadores> {
    validarPeriodo(desde, hasta);

    const [oe1, oe2, oe3] = await Promise.all([
      this.facturacionDigital(desde, hasta),
      this.quiebresDeStock(desde, hasta),
      this.alcanceTerritorial(desde, hasta),
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

  /** `total`: monto del período anterior; `cumplidos`: monto del período. */
  private async facturacionDigital(
    desde: string,
    hasta: string,
  ): Promise<Conteo | undefined> {
    const [fila] = await this.prisma.$queryRaw<Conteo[]>`
      WITH limites AS (
        SELECT (${desde}::date - (${hasta}::date - ${desde}::date + 1))::timestamp AT TIME ZONE 'America/Santiago' AS inicio_anterior,
               (${desde}::date)::timestamp AT TIME ZONE 'America/Santiago' AS inicio,
               (${hasta}::date + 1)::timestamp AT TIME ZONE 'America/Santiago' AS fin
      )
      SELECT COALESCE(SUM(p.monto_total) FILTER (WHERE p.fecha_pedido < l.inicio), 0) AS "total",
             COALESCE(SUM(p.monto_total) FILTER (WHERE p.fecha_pedido >= l.inicio), 0) AS "cumplidos"
      FROM pedido p, limites l
      WHERE p.fecha_pedido >= l.inicio_anterior
        AND p.fecha_pedido < l.fin
        AND p.estado_actual <> ALL(${ESTADOS_SIN_VENTA}::text[])`;
    return fila;
  }

  /**
   * `total`: quiebres del período anterior; `cumplidos`: quiebres del período. El saldo de cada
   * formato se reconstruye con todos sus movimientos hasta el fin del período.
   */
  private async quiebresDeStock(
    desde: string,
    hasta: string,
  ): Promise<Conteo | undefined> {
    const [fila] = await this.prisma.$queryRaw<Conteo[]>`
      WITH limites AS (
        SELECT (${desde}::date - (${hasta}::date - ${desde}::date + 1))::timestamp AT TIME ZONE 'America/Santiago' AS inicio_anterior,
               (${desde}::date)::timestamp AT TIME ZONE 'America/Santiago' AS inicio,
               (${hasta}::date + 1)::timestamp AT TIME ZONE 'America/Santiago' AS fin
      ),
      saldos AS (
        SELECT m.id_formato,
               m.id_movimiento,
               m.fecha_hora,
               SUM(CASE
                     WHEN m.tipo = ANY(${TIPOS_QUE_SUMAN}::text[]) THEN m.cantidad
                     WHEN m.tipo = ANY(${TIPOS_QUE_RESTAN}::text[]) THEN -m.cantidad
                     ELSE 0
                   END) OVER (PARTITION BY m.id_formato ORDER BY m.fecha_hora, m.id_movimiento) AS saldo
        FROM movimiento_inventario m, limites l
        WHERE m.fecha_hora < l.fin
      ),
      cambios AS (
        SELECT s.fecha_hora,
               s.saldo,
               LAG(s.saldo, 1, 0::bigint) OVER (PARTITION BY s.id_formato ORDER BY s.fecha_hora, s.id_movimiento) AS saldo_previo
        FROM saldos s
      )
      SELECT COUNT(*) FILTER (WHERE c.fecha_hora < l.inicio) AS "total",
             COUNT(*) FILTER (WHERE c.fecha_hora >= l.inicio) AS "cumplidos"
      FROM cambios c, limites l
      WHERE c.saldo <= 0
        AND c.saldo_previo > 0
        AND c.fecha_hora >= l.inicio_anterior`;
    return fila;
  }

  /** `total`: pedidos pagados del período; `cumplidos`: los despachados fuera de la zona local. */
  private async alcanceTerritorial(
    desde: string,
    hasta: string,
  ): Promise<Conteo | undefined> {
    const [fila] = await this.prisma.$queryRaw<Conteo[]>`
      SELECT COUNT(*) AS "total",
             COUNT(*) FILTER (
               WHERE c.codigo_cut IS NOT NULL
                 AND c.codigo_cut <> ALL(${COMUNAS_LOCALES}::text[])
             ) AS "cumplidos"
      FROM pedido p
      LEFT JOIN envio e ON e.id_pedido = p.id_pedido
      LEFT JOIN comuna c ON c.id_comuna = e.id_comuna
      WHERE p.fecha_pedido >= (${desde}::date)::timestamp AT TIME ZONE 'America/Santiago'
        AND p.fecha_pedido < (${hasta}::date + 1)::timestamp AT TIME ZONE 'America/Santiago'
        AND p.estado_actual <> ALL(${ESTADOS_SIN_VENTA}::text[])`;
    return fila;
  }
}
