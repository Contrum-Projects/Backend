/** Formatos de imagen que acepta el catálogo (E3-H3, decisión del 24 oct). */
export interface TipoImagen {
  tipoContenido: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
}

const empiezaCon = (contenido: Buffer, firma: number[], desde = 0) =>
  contenido.length >= desde + firma.length &&
  firma.every((byte, i) => contenido[desde + i] === byte);

const ascii = (texto: string) => [...Buffer.from(texto, 'latin1')];

/**
 * Reconoce el formato por los primeros bytes del archivo (su firma), no por la extensión ni por
 * el tipo que declara el navegador, que el cliente puede falsear. Devuelve `null` si no es JPEG,
 * PNG ni WebP.
 */
export const detectarTipoImagen = (contenido: Buffer): TipoImagen | null => {
  if (empiezaCon(contenido, [0xff, 0xd8, 0xff])) {
    return { tipoContenido: 'image/jpeg', extension: 'jpg' };
  }
  if (empiezaCon(contenido, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { tipoContenido: 'image/png', extension: 'png' };
  }
  if (
    empiezaCon(contenido, ascii('RIFF')) &&
    empiezaCon(contenido, ascii('WEBP'), 8)
  ) {
    return { tipoContenido: 'image/webp', extension: 'webp' };
  }
  return null;
};
