import { lunesDeLaSemana } from '../../common/dominio/fechas.js';
import { ROLES } from '../../common/dominio/roles.js';

const HORA_MS = 60 * 60 * 1000;

/** Plazos de la serie, en horas desde el último cambio del carrito (E12-H4, RF-12.04). */
export const PLAZOS_RECORDATORIO_HORAS = [1, 24, 72] as const;

/**
 * Hasta cuándo se recuerda un carrito sin cambios: 24 h después del último plazo. Un carrito más
 * antiguo ya no se recuerda, así la tarea no le escribe a carritos olvidados hace semanas (por
 * ejemplo, al ponerse en marcha o si estuvo detenida).
 */
export const FIN_SERIE_HORAS = 96;

/** Lo que la regla necesita del carrito. */
export interface EstadoSerieCarrito {
  fechaActualizacion: Date;
  /** Inicio de la última serie: cuándo salió su primer recordatorio. */
  fechaRecordatorio: Date | null;
  /** Último recordatorio enviado de esa serie (1 a 3). */
  recordatoriosEnviados: number;
}

export interface RecordatorioDebido {
  /** Qué recordatorio corresponde: 1, 2 o 3. */
  numero: number;
  /** Empieza una serie nueva: se guarda su inicio. */
  iniciaSerie: boolean;
}

/** Cuenta a la que se le puede recordar el carrito: dueña que acepta publicidad (E12-H4, CA1). */
export interface DuenoCarrito {
  activo: boolean;
  rol: string;
  aceptaMarketingEmail: boolean;
  fechaVerificacionCorreo: Date | null;
}

export const ROLES_CON_CARRITO: readonly string[] = [
  ROLES.CLIENTE,
  ROLES.PROFESIONAL,
];

export const puedeRecibirRecordatorio = (dueno: DuenoCarrito): boolean =>
  dueno.activo &&
  ROLES_CON_CARRITO.includes(dueno.rol) &&
  dueno.aceptaMarketingEmail &&
  dueno.fechaVerificacionCorreo !== null;

/**
 * E12-H4 · Qué recordatorio le toca a un carrito con artículos en este momento, o `null`.
 *
 * - La serie está en curso si empezó después del último cambio: comprar o modificar el carrito
 *   cambia `fechaActualizacion` y la corta (CA2).
 * - Cada recordatorio sale al cumplirse su plazo. Si la tarea se atrasó y ya venció el siguiente,
 *   sale ese y no los atrasados: nunca dos seguidos.
 * - Una serie nueva no empieza en la misma semana (lunes a domingo, hora de Chile) en que empezó
 *   la anterior (CA3).
 */
export const recordatorioDebido = (
  carrito: EstadoSerieCarrito,
  ahora: Date,
): RecordatorioDebido | null => {
  const horas =
    (ahora.getTime() - carrito.fechaActualizacion.getTime()) / HORA_MS;
  if (horas >= FIN_SERIE_HORAS) return null;
  const numero = PLAZOS_RECORDATORIO_HORAS.filter(
    (plazo) => horas >= plazo,
  ).length;
  if (numero === 0) return null;

  const { fechaRecordatorio } = carrito;
  const serieEnCurso =
    fechaRecordatorio !== null &&
    fechaRecordatorio.getTime() > carrito.fechaActualizacion.getTime();
  if (serieEnCurso) {
    return numero > carrito.recordatoriosEnviados
      ? { numero, iniciaSerie: false }
      : null;
  }
  if (
    fechaRecordatorio !== null &&
    lunesDeLaSemana(fechaRecordatorio) === lunesDeLaSemana(ahora)
  ) {
    return null;
  }
  return { numero, iniciaSerie: true };
};
