/**
 * Almacén de archivos públicos (imágenes del catálogo). El servicio de negocio solo conoce esta
 * interfaz: en producción es Cloudflare R2 y en las pruebas un doble.
 *
 * La clave del objeto es la que se guarda en la base (`imagen_articulo.ubicacion_archivo`); la
 * URL se arma al responder con `urlPublicaArchivo`, así cambiar de dominio no toca los datos.
 */
export abstract class AlmacenArchivos {
  /** Guarda el archivo con esa clave. Falla con 503 si el almacén no está configurado. */
  abstract guardar(
    clave: string,
    contenido: Buffer,
    tipoContenido: string,
  ): Promise<void>;

  /** Borra el archivo. No falla si ya no existe. */
  abstract eliminar(clave: string): Promise<void>;
}

/**
 * URL pública de un archivo guardado. Sin dominio configurado (desarrollo sin R2) devuelve la
 * clave tal cual. La clave la arma siempre el servidor: ningún DTO la recibe.
 */
export const urlPublicaArchivo = (
  base: string | undefined,
  clave: string,
): string => (base ? `${base}/${clave}` : clave);
