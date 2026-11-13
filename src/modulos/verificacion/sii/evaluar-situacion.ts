import {
  GIRO_PELUQUERIA,
  RESULTADOS_CONSULTA_SII,
} from '../../../common/dominio/valores.js';
import type { ActividadSii } from './proveedor-situacion-tributaria.js';

/**
 * Lo que se concluye de las actividades de un RUT; la consulta que falla y el nombre que no calza
 * (`nombre-contribuyente.ts`) se registran aparte.
 */
export type ResultadoEvaluacion = Exclude<
  (typeof RESULTADOS_CONSULTA_SII)[keyof typeof RESULTADOS_CONSULTA_SII],
  | typeof RESULTADOS_CONSULTA_SII.NO_DISPONIBLE
  | typeof RESULTADOS_CONSULTA_SII.NOMBRE_NO_COINCIDE
>;

/**
 * Regla de aprobación automática (E10-H1, decisión del 2 de noviembre de 2026): el RUT tiene el
 * giro 960200 con inicio de actividades ya cumplido. El SII lista las actividades vigentes y
 * Khipu no trae un campo de vigencia, así que «vigente» es «está en la lista y su fecha de
 * inicio ya pasó». Una fecha que falta no se puede confirmar: no aprueba. Esto nunca rechaza:
 * cualquier otro resultado deja la solicitud a la espera de documentos.
 *
 * `hoy` es AAAA-MM-DD en la zona horaria de la tienda.
 */
export const evaluarSituacion = (
  actividades: ActividadSii[],
  hoy: string,
): ResultadoEvaluacion => {
  if (actividades.length === 0) {
    return RESULTADOS_CONSULTA_SII.SIN_INICIO_ACTIVIDADES;
  }
  const peluqueria = actividades.filter(
    (actividad) => actividad.codigo === GIRO_PELUQUERIA,
  );
  if (peluqueria.length === 0) return RESULTADOS_CONSULTA_SII.OTRO_GIRO;
  const iniciada = peluqueria.some(
    (actividad) =>
      actividad.fechaInicio !== null && actividad.fechaInicio <= hoy,
  );
  return iniciada
    ? RESULTADOS_CONSULTA_SII.APROBADO
    : RESULTADOS_CONSULTA_SII.SIN_INICIO_ACTIVIDADES;
};
