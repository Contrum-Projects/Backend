/**
 * Roles fijos, definidos en el código (RF-13.02, decisión del equipo del 8 de octubre).
 * Cada cuenta tiene un solo rol. Los roles no se editan desde el panel.
 * Los permisos de cada rol están en `permisos.ts` (E13-H2).
 */
export const ROLES = {
  CLIENTE: 'cliente',
  PROFESIONAL: 'profesional',
  VENDEDOR: 'vendedor',
  BODEGUERO: 'bodeguero',
  ADMINISTRADOR: 'administrador',
} as const;

export type Rol = (typeof ROLES)[keyof typeof ROLES];

/** «Personal de tienda»: los roles que entran al panel de administración. */
export const ROLES_PERSONAL: readonly Rol[] = [
  ROLES.VENDEDOR,
  ROLES.BODEGUERO,
  ROLES.ADMINISTRADOR,
];

/** Roles que compran en la tienda. Solo el profesional ve el precio mayorista (RNF-04). */
export const ROLES_COMPRADOR: readonly Rol[] = [
  ROLES.CLIENTE,
  ROLES.PROFESIONAL,
];
