import type { Rol } from '../common/dominio/roles.js';

/**
 * Audiencia y algoritmo de los tokens de acceso: otro JWT firmado con el mismo
 * secreto (de otro uso) no sirve como token de acceso.
 */
export const AUDIENCIA_TOKEN_ACCESO = 'cp-acceso';
export const ALGORITMO_TOKEN_ACCESO = 'HS256';

/**
 * Lo que el JWT de acceso lleva: la cuenta y la sesión por su `codigoPublico`
 * (nunca el id, RNF-07) y el rol. `sid` permite revocar el token al cerrar la
 * sesión, sin esperar a que caduque (RNF-28).
 */
export interface CargaTokenAcceso {
  sub: string;
  sid: string;
  rol: Rol;
}

/** La cuenta autenticada que el guard deja en la petición. */
export interface UsuarioAutenticado {
  codigoPublico: string;
  rol: Rol;
  /** `codigoPublico` de la sesión del token. */
  sesion: string;
}
