/**
 * Límites de peticiones por IP (RNF-09). Se aplican con
 * `@Throttle({ default: LIMITES.X })` junto a `@UseGuards(ThrottlerGuard)`.
 */
export const LIMITES = {
  /** Registro y confirmación del correo (E1-H1, decisión del 14 oct 2026): 5/min. */
  REGISTRO: { limit: 5, ttl: 60_000 },
} as const;
