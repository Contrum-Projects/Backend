import { lunesDeLaSemana } from '../../common/dominio/fechas.js';
import {
  FIN_SERIE_HORAS,
  PLAZOS_RECORDATORIO_HORAS,
} from '../marketing/recordatorio-carrito.js';

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

/**
 * Cuánto puede durar una serie de recordatorios (E12-H4): el primero sale al menos 1 h después del
 * último cambio y ninguno sale pasadas 96 h, así que todos caen dentro de las 95 h desde su inicio.
 */
export const DURACION_MAXIMA_SERIE_HORAS =
  FIN_SERIE_HORAS - PLAZOS_RECORDATORIO_HORAS[0];

/** Días desde el primer recordatorio en que una compra pagada recupera el carrito (decisión del 6 nov). */
export const DIAS_PARA_RECUPERAR = 7;

/** Un recordatorio o una compra pagada de una cuenta. */
export interface EventoCuenta {
  usuarioId: number;
  fecha: Date;
}

export interface SerieAbandono {
  usuarioId: number;
  /** Cuándo salió su primer recordatorio. */
  inicio: Date;
  /** Terminó en una compra pagada. */
  recuperada: boolean;
}

const porCuenta = (eventos: EventoCuenta[]): Map<number, Date[]> => {
  const mapa = new Map<number, Date[]>();
  for (const { usuarioId, fecha } of eventos) {
    const fechas = mapa.get(usuarioId) ?? [];
    fechas.push(fecha);
    mapa.set(usuarioId, fechas);
  }
  for (const fechas of mapa.values()) {
    fechas.sort((a, b) => a.getTime() - b.getTime());
  }
  return mapa;
};

/**
 * Inicios de las series de una cuenta. Los recordatorios no guardan a qué serie pertenecen, así
 * que se deduce de la regla de E12-H4: una serie nueva no empieza en la semana (lunes a domingo,
 * hora de Chile) en que empezó la anterior, y ningún recordatorio de una serie sale 95 h o más
 * después de su inicio. Un recordatorio abre serie si cumple ambas cosas. Caso que se acepta
 * contar como una sola serie: una que empezó el fin de semana y otra que empezó el lunes siguiente
 * dentro de esas 95 h, porque el cliente volvió a cambiar el carrito.
 */
const iniciosDeSeries = (recordatorios: Date[]): Date[] => {
  const inicios: Date[] = [];
  for (const fecha of recordatorios) {
    const actual = inicios.at(-1);
    const abreSerie =
      actual === undefined ||
      (lunesDeLaSemana(fecha) !== lunesDeLaSemana(actual) &&
        fecha.getTime() - actual.getTime() >=
          DURACION_MAXIMA_SERIE_HORAS * HORA_MS);
    if (abreSerie) inicios.push(fecha);
  }
  return inicios;
};

/**
 * E14-H3 · Series de carrito abandonado y si terminaron en compra. Una serie se recupera si la
 * misma cuenta hizo un pedido pagado después de su primer recordatorio, dentro de
 * `DIAS_PARA_RECUPERAR` días y antes de que empiece la serie siguiente (así una compra recupera a
 * lo más una serie).
 */
export const seriesAbandono = (
  recordatorios: EventoCuenta[],
  compras: EventoCuenta[],
): SerieAbandono[] => {
  const comprasPorCuenta = porCuenta(compras);
  const series: SerieAbandono[] = [];
  for (const [usuarioId, fechas] of porCuenta(recordatorios)) {
    const inicios = iniciosDeSeries(fechas);
    const comprasCuenta = comprasPorCuenta.get(usuarioId) ?? [];
    inicios.forEach((inicio, indice) => {
      const siguiente = inicios[indice + 1];
      const limite = Math.min(
        inicio.getTime() + DIAS_PARA_RECUPERAR * DIA_MS,
        siguiente?.getTime() ?? Number.POSITIVE_INFINITY,
      );
      const recuperada = comprasCuenta.some(
        (compra) =>
          compra.getTime() > inicio.getTime() && compra.getTime() < limite,
      );
      series.push({ usuarioId, inicio, recuperada });
    });
  }
  return series;
};
