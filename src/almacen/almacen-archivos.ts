/**
 * Almacén de archivos (imágenes del catálogo y facturas). El servicio de negocio solo conoce esta
 * interfaz: en producción es Cloudflare R2 y en las pruebas un doble.
 *
 * La clave del objeto es la que se guarda en la base (`imagen_articulo.ubicacion_archivo`); la
 * URL se arma al responder con `urlPublicaArchivo`, así cambiar de dominio no toca los datos.
 */
export abstract class AlmacenArchivos {
  /**
   * Guarda el archivo con esa clave. `privado` marca un archivo que no debe quedar en cachés
   * compartidas (una factura); solo se entrega por la API, nunca con una URL pública. Falla con
   * 503 si el almacén no está configurado.
   */
  abstract guardar(
    clave: string,
    contenido: Buffer,
    tipoContenido: string,
    privado?: boolean,
  ): Promise<void>;

  /** Borra el archivo. No falla si ya no existe. */
  abstract eliminar(clave: string): Promise<void>;

  /**
   * Lee el archivo completo (se usa con las facturas, de hasta 5 MB). Falla con 503 si el
   * almacén no está configurado y con un error si el archivo no existe.
   */
  abstract obtener(clave: string): Promise<Buffer>;
}

/**
 * URL pública de un archivo guardado. Sin dominio configurado (desarrollo sin R2) devuelve la
 * clave tal cual. La clave la arma siempre el servidor: ningún DTO la recibe.
 */
export const urlPublicaArchivo = (
  base: string | undefined,
  clave: string,
): string => (base ? `${base}/${clave}` : clave);
