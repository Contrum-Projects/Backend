import { ESTADOS_SOLICITUD } from '../../common/dominio/valores.js';

/**
 * Días que se conservan los archivos de una solicitud resuelta (E10-H6, RF-10.12). Se cuentan
 * como 30 × 24 horas exactas desde `fecha_resolucion` (decisión del 5 nov 2026): la que cumple
 * justo 30 días ya se elimina.
 */
export const DIAS_CONSERVACION_ARCHIVOS = 30;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Estados de una solicitud resuelta: el sistema nunca rechaza solo (RNF-27). */
export const ESTADOS_RESUELTOS = [
  ESTADOS_SOLICITUD.APROBADA,
  ESTADOS_SOLICITUD.RECHAZADA,
] as const;

/**
 * Una solicitud resuelta en esta fecha o antes ya no necesita sus archivos. El servicio filtra con
 * `fechaResolucion <= límite`; el borde exacto se prueba contra la base en la e2e.
 */
export const limiteConservacionArchivos = (ahora: Date): Date =>
  new Date(ahora.getTime() - DIAS_CONSERVACION_ARCHIVOS * DIA_MS);
