/**
 * Límites de peticiones por IP (RNF-09). Se aplican con
 * `@Throttle({ default: LIMITES.X })` junto a `@UseGuards(ThrottlerGuard)`.
 */
export const LIMITES = {
  /** Registro y confirmación del correo (E1-H1, decisión del 14 oct 2026): 5/min. */
  REGISTRO: { limit: 5, ttl: 60_000 },
  /** Cierre de sesión en el dispositivo (E1-H3, decisión del 18 oct 2026): 30/min. */
  CIERRE_SESION: { limit: 30, ttl: 60_000 },
  /** Aceptar la invitación del personal (E13-H1, decisión del 18 oct 2026): 5/min, como el registro. */
  ACEPTAR_INVITACION: { limit: 5, ttl: 60_000 },
  /**
   * Editar los datos personales (E1-H5, decisión del 20 oct 2026): 10/hora por cuenta, con
   * `LimitePorCuentaGuard`. Alcanza para corregir datos y frena probar RUT en serie (el 409
   * indica si un RUT ya tiene cuenta).
   */
  EDITAR_DATOS: { limit: 10, ttl: 60 * 60_000 },
} as const;

/**
 * Intentos fallidos de inicio de sesión (RNF-09, E1-H2, decisión del 17 oct 2026).
 * Se cuentan en Redis por correo + IP y, como tope, por IP; solo los fallidos.
 * Al llegar al máximo, los nuevos intentos responden 429 hasta que vence la ventana.
 */
export const LIMITE_INICIO_SESION = {
  fallidosPorCorreo: 5,
  fallidosPorIp: 20,
  ventanaMs: 15 * 60_000,
} as const;
