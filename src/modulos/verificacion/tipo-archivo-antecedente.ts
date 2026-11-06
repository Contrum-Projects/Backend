import { detectarTipoImagen } from '../catalogo/tipo-imagen.js';
import { esPdf } from '../facturacion/tipo-archivo-factura.js';

/** Documentos por solicitud (E10-H2, confirmado por el equipo el 2 de noviembre de 2026). */
export const MAXIMO_ANTECEDENTES = 5;

/**
 * Tamaño máximo de cada documento (E10-H2, confirmado por el equipo el 2 de noviembre de 2026; bajó
 * de 5 a 4 MB el 6 de noviembre, SCRUM-150, para caber en el proxy de la tienda).
 */
export const TAMANO_MAXIMO_ANTECEDENTE_BYTES = 4 * 1024 * 1024;

/** Formato de un documento que acepta la solicitud de verificación. */
export interface TipoArchivoAntecedente {
  tipoContenido: 'application/pdf' | 'image/jpeg' | 'image/png';
  extension: 'pdf' | 'jpg' | 'png';
}

/**
 * Reconoce el formato por los primeros bytes del archivo (su firma), no por la extensión ni por
 * el tipo que declara el navegador, que el cliente puede falsear. Acepta PDF, JPEG y PNG; devuelve
 * `null` con cualquier otro (WebP incluido).
 */
export const detectarTipoAntecedente = (
  contenido: Buffer,
): TipoArchivoAntecedente | null => {
  if (esPdf(contenido)) {
    return { tipoContenido: 'application/pdf', extension: 'pdf' };
  }
  const imagen = detectarTipoImagen(contenido);
  if (imagen?.tipoContenido === 'image/jpeg') {
    return { tipoContenido: 'image/jpeg', extension: 'jpg' };
  }
  if (imagen?.tipoContenido === 'image/png') {
    return { tipoContenido: 'image/png', extension: 'png' };
  }
  return null;
};
