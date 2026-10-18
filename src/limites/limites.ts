/**
 * Límites de peticiones por IP (RNF-09). Se aplican con
 * `@Throttle({ default: LIMITES.X })` junto a `@UseGuards(ThrottlerGuard)`.
 */
export const LIMITES = {
  /** Registro y confirmación del correo (E1-H1, decisión del 14 oct 2026): 5/min. */
  REGISTRO: { limit: 5, ttl: 60_000 },
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
