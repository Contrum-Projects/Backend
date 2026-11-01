/** Tamaño máximo del PDF de una factura (E9-H3, confirmado por el equipo el 31 de octubre de 2026). */
export const TAMANO_MAXIMO_FACTURA_BYTES = 5 * 1024 * 1024;

const FIRMA_PDF = Buffer.from('%PDF-', 'latin1');

/**
 * Si el archivo es un PDF, por sus primeros bytes (su firma) y no por la extensión ni por el tipo
 * que declara el navegador, que el cliente puede falsear.
 */
export const esPdf = (contenido: Buffer): boolean =>
  contenido.length >= FIRMA_PDF.length &&
  contenido.subarray(0, FIRMA_PDF.length).equals(FIRMA_PDF);
