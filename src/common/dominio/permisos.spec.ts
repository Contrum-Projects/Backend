import { PERMISOS, PERMISOS_POR_ROL, tienePermiso } from './permisos.js';
import { ROLES, type Rol } from './roles.js';

describe('tienePermiso', () => {
  it('E13-H2 · acción permitida: el administrador tiene todos los permisos y cada rol los suyos', () => {
    for (const permiso of Object.values(PERMISOS)) {
      expect(tienePermiso(ROLES.ADMINISTRADOR, permiso)).toBe(true);
    }
    expect(tienePermiso(ROLES.VENDEDOR, PERMISOS.CATALOGO_GESTIONAR)).toBe(
      true,
    );
    expect(tienePermiso(ROLES.BODEGUERO, PERMISOS.INVENTARIO_REGISTRAR)).toBe(
      true,
    );
  });

  it('E13-H2 · acción sin permiso: vendedor y bodeguero no tienen permisos ajenos', () => {
    for (const permiso of [
      PERMISOS.PRECIOS_GESTIONAR,
      PERMISOS.PERSONAL_GESTIONAR,
      PERMISOS.PROVEEDORES_GESTIONAR,
    ]) {
      expect(tienePermiso(ROLES.VENDEDOR, permiso)).toBe(false);
    }
    for (const permiso of [
      PERMISOS.CATALOGO_GESTIONAR,
      PERMISOS.PRECIOS_GESTIONAR,
    ]) {
      expect(tienePermiso(ROLES.BODEGUERO, permiso)).toBe(false);
    }
  });

  it('E13-H2 · cliente en el panel: cliente y profesional no tienen ningún permiso', () => {
    for (const rol of [ROLES.CLIENTE, ROLES.PROFESIONAL]) {
      for (const permiso of Object.values(PERMISOS)) {
        expect(tienePermiso(rol, permiso)).toBe(false);
      }
    }
  });

  it('E13-H2 · la matriz es la acordada el 19 de octubre para cada rol y permiso', () => {
    // Copia literal de la tabla de docs/reglas-de-negocio.md (E13): si cambia la matriz, cambia esto
    const vendedor = [
      'catalogo.gestionar',
      'inventario.consultar',
      'pedidos.gestionar',
    ];
    const bodeguero = [
      'proveedores.gestionar',
      'inventario.registrar',
      'inventario.consultar',
      'pedidos.gestionar',
    ];
    for (const permiso of Object.values(PERMISOS)) {
      expect(tienePermiso(ROLES.VENDEDOR, permiso), permiso).toBe(
        vendedor.includes(permiso),
      );
      expect(tienePermiso(ROLES.BODEGUERO, permiso), permiso).toBe(
        bodeguero.includes(permiso),
      );
    }
    expect(Object.values(PERMISOS)).toHaveLength(10);
  });

  it('RNF-03 · la matriz no se puede ampliar en ejecución', () => {
    expect(Object.isFrozen(PERMISOS_POR_ROL)).toBe(true);
    for (const permisos of Object.values(PERMISOS_POR_ROL)) {
      expect(Object.isFrozen(permisos)).toBe(true);
    }
  });

  it('RNF-03 · un rol desconocido no tiene permisos', () => {
    expect(tienePermiso('hacker' as Rol, PERMISOS.REPORTES_VER)).toBe(false);
  });
});
