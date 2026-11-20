/**
 * URLs sin los tokens que viajan en ellas (RNF-02, RNF-05, SCRUM-168), para el log y el
 * registro de errores: el `?token=` de los enlaces de los correos (confirmar la cuenta o la
 * suscripción, recuperar la contraseña, activar al personal) y el token del seguimiento de la
 * publicidad, que va en el camino (`/marketing/seguimiento/apertura/:token`).
 */

export const OCULTO = '[Redacted]';

const TOKEN_EN_EL_CAMINO =
  /(\/marketing\/seguimiento\/(?:apertura|clic)\/)[^/?#]+/i;
const TOKEN_EN_LA_QUERY = /([?&]token=)[^&#]*/gi;

export const urlSinSecretos = (url: string): string =>
  url
    .replace(TOKEN_EN_EL_CAMINO, `$1${OCULTO}`)
    .replace(TOKEN_EN_LA_QUERY, `$1${OCULTO}`);

interface PeticionSerializada {
  url?: unknown;
  params?: unknown;
}

/**
 * Serializador de `req` para pino-http: la URL sin tokens y sin `params`, que repite los
 * tramos del camino (y con ellos el token del seguimiento). La query la cubre `redact`.
 */
export const peticionParaElLog = <T extends PeticionSerializada>(
  peticion: T,
): T => {
  if (typeof peticion.url === 'string') {
    peticion.url = urlSinSecretos(peticion.url);
  }
  delete peticion.params;
  return peticion;
};
