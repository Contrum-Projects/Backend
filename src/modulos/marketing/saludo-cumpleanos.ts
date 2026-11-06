/**
 * Configuración del saludo de cumpleaños (E12-H5, decisión del 5 de noviembre de 2026). Vive en
 * una sola fila de CAMPANA con tipo `cumpleanos`: el asunto y el cuerpo son los del saludo y la
 * oferta va en `campana.segmento` como JSON `{ "oferta": { "activa", "texto" } }`. Sin cambios al MER.
 */

/** Asunto por defecto, mientras el administrador no configura el saludo. PROPUESTA por confirmar. */
export const ASUNTO_CUMPLEANOS_POR_DEFECTO =
  '¡Feliz cumpleaños de parte de Cabello Perfecto!';

/** Saludo por defecto (texto plano). PROPUESTA por confirmar con el equipo. */
export const CUERPO_CUMPLEANOS_POR_DEFECTO =
  'En Cabello Perfecto queremos desearte un muy feliz cumpleaños.\n\nGracias por acompañarnos. Esperamos que este nuevo año venga lleno de días buenos para ti y para tu cabello.';

/** Largo máximo del texto de la oferta. */
export const MAXIMO_TEXTO_OFERTA = 1_000;

export interface OfertaCumpleanos {
  activa: boolean;
  /** Texto libre de la oferta: el backend no aplica descuentos. Se conserva aunque esté inactiva. */
  texto: string | null;
}

export interface SaludoCumpleanos {
  asunto: string;
  cuerpo: string;
  oferta: OfertaCumpleanos;
}

const SIN_OFERTA: OfertaCumpleanos = { activa: false, texto: null };

/** El saludo que rige mientras no se configura. */
export const SALUDO_POR_DEFECTO: SaludoCumpleanos = {
  asunto: ASUNTO_CUMPLEANOS_POR_DEFECTO,
  cuerpo: CUERPO_CUMPLEANOS_POR_DEFECTO,
  oferta: SIN_OFERTA,
};

/** La oferta como se guarda en `campana.segmento`. */
export const textoOferta = (oferta: OfertaCumpleanos): string =>
  JSON.stringify({ oferta: { activa: oferta.activa, texto: oferta.texto } });

/**
 * Lee la oferta guardada. Un valor que no se entiende cuenta como sin oferta: el saludo sale igual
 * y nunca con una oferta que el administrador no activó.
 */
export const leerOferta = (segmento: string | null): OfertaCumpleanos => {
  if (!segmento) return SIN_OFERTA;
  try {
    const { oferta } = JSON.parse(segmento) as { oferta?: unknown };
    if (typeof oferta !== 'object' || oferta === null) return SIN_OFERTA;
    const { activa, texto } = oferta as { activa?: unknown; texto?: unknown };
    const textoValido =
      typeof texto === 'string' && texto.trim().length > 0 ? texto : null;
    return {
      activa: activa === true && textoValido !== null,
      texto: textoValido,
    };
  } catch {
    return SIN_OFERTA;
  }
};

/** El texto de la oferta que va en el correo, o `null` si no está activa. */
export const ofertaDelCorreo = (oferta: OfertaCumpleanos): string | null =>
  oferta.activa ? oferta.texto : null;
