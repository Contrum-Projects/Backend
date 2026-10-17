import { createHash, randomBytes } from 'node:crypto';

/**
 * Tokens de los enlaces de correo (RNF-01, RNF-08): 256 bits aleatorios, de modo
 * que no se pueden adivinar. Solo se guarda su hash SHA-256, que permite buscarlo
 * por índice; el token en claro solo viaja en el enlace.
 */
export const generarTokenCorreo = (): { token: string; hash: string } => {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashearTokenCorreo(token) };
};

export const hashearTokenCorreo = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** Token de refresco de la sesión (E1-H2): mismo formato; solo se guarda su hash. */
export const generarTokenSesion = generarTokenCorreo;
export const hashearTokenSesion = hashearTokenCorreo;
