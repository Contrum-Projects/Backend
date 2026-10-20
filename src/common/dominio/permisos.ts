/**
 * Permisos fijos, definidos en el código
 * (RF-13.03, decisión del equipo del 19 de octubre).
 * Los roles tienen permisos asignados. Los permisos no se editan desde el panel.
 *
 * Los clientes y profesionales no tienen permisos asignados,
 * ya que no acceden al panel de administración.
 */
import { type Rol, ROLES } from './roles.js';

export const PERMISOS = {
  PERSONAL_GESTIONAR: 'personal.gestionar',
  PROVEEDORES_GESTIONAR: 'proveedores.gestionar',
  INVENTARIO_REGISTRAR: 'inventario.registrar',
  INVENTARIO_CONSULTAR: 'inventario.consultar',
  CATALOGO_GESTIONAR: 'catalogo.gestionar',
  PRECIOS_GESTIONAR: 'precios.gestionar',
  PEDIDOS_GESTIONAR: 'pedidos.gestionar',
  VERIFICACION_GESTIONAR: 'verificacion.gestionar',
  CAMPANAS_GESTIONAR: 'campanas.gestionar',
  REPORTES_VER: 'reportes.ver',
} as const;

export type Permiso = (typeof PERMISOS)[keyof typeof PERMISOS];

// Congelada: `readonly` solo existe en los tipos; así nadie amplía permisos en ejecución
export const PERMISOS_POR_ROL: Readonly<Record<Rol, readonly Permiso[]>> =
  Object.freeze({
    /* Administrador: tiene todos los permisos */
    [ROLES.ADMINISTRADOR]: Object.freeze(Object.values(PERMISOS)),
    [ROLES.BODEGUERO]: Object.freeze([
      PERMISOS.INVENTARIO_CONSULTAR,
      PERMISOS.INVENTARIO_REGISTRAR,
      PERMISOS.PROVEEDORES_GESTIONAR,
      PERMISOS.PEDIDOS_GESTIONAR,
    ]),
    [ROLES.VENDEDOR]: Object.freeze([
      PERMISOS.CATALOGO_GESTIONAR,
      PERMISOS.INVENTARIO_CONSULTAR,
      PERMISOS.PEDIDOS_GESTIONAR,
    ]),
    /* Cliente: no tiene permisos asignados */
    [ROLES.CLIENTE]: Object.freeze([]),
    /* Profesional: no tiene permisos asignados */
    [ROLES.PROFESIONAL]: Object.freeze([]),
  });

export const tienePermiso = (rol: Rol, permiso: Permiso): boolean => {
  const permisos = PERMISOS_POR_ROL[rol];
  return permisos?.includes(permiso) ?? false;
};
