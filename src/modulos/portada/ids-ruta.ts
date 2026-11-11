import { IdRutaPipe } from '../../common/validacion/id-ruta.pipe.js';

/** Id del slide en la URL; un valor imposible responde 404 como uno inexistente. */
export const ID_SLIDE = new IdRutaPipe('La imagen de la portada no existe.');
