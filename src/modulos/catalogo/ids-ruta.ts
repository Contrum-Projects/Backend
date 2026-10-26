import { IdRutaPipe } from '../../common/validacion/id-ruta.pipe.js';

/** Ids de la URL del catálogo; un valor imposible responde 404 como uno inexistente. */
export const ID_PRODUCTO = new IdRutaPipe('El producto no existe.');
export const ID_FORMATO = new IdRutaPipe('El formato no existe.');
export const ID_PACK = new IdRutaPipe('El pack no existe.');
/** El id del artículo es el del formato o el del pack. */
export const ID_ARTICULO = new IdRutaPipe('El artículo no existe.');
export const ID_IMAGEN = new IdRutaPipe('La imagen no existe.');
export const ID_CATEGORIA = new IdRutaPipe('La categoría no existe.');
