import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISOS } from '../common/dominio/permisos.js';
import { ROLES, type Rol } from '../common/dominio/roles.js';
import { PermisosGuard, RequierePermiso } from './permisos.guard.js';

describe('PermisosGuard', () => {
  const guard = new PermisosGuard(new Reflector());

  @RequierePermiso(PERMISOS.INVENTARIO_CONSULTAR)
  class Panel {
    @RequierePermiso(PERMISOS.PRECIOS_GESTIONAR)
    cambiarPrecio() {}

    consultarStock() {}
  }

  class SinPermiso {
    abierta() {}
  }

  const contexto = (
    clase: typeof Panel | typeof SinPermiso,
    metodo: string,
    rol?: Rol,
  ) =>
    ({
      getHandler: () =>
        Object.getOwnPropertyDescriptor(clase.prototype, metodo)?.value,
      getClass: () => clase,
      switchToHttp: () => ({
        getRequest: () => ({
          usuario: rol ? { codigoPublico: 'x', rol, sesion: 'y' } : undefined,
        }),
      }),
    }) as unknown as ExecutionContext;

  it('E13-H2 · acción permitida: el rol con el permiso de la ruta pasa', () => {
    expect(
      guard.canActivate(contexto(Panel, 'cambiarPrecio', ROLES.ADMINISTRADOR)),
    ).toBe(true);
    // Sin decorador en el método vale el del controlador
    for (const rol of [ROLES.VENDEDOR, ROLES.BODEGUERO]) {
      expect(guard.canActivate(contexto(Panel, 'consultarStock', rol))).toBe(
        true,
      );
    }
  });

  it('E13-H2 · acción sin permiso: el personal sin el permiso recibe 403', () => {
    for (const rol of [ROLES.VENDEDOR, ROLES.BODEGUERO]) {
      expect(() =>
        guard.canActivate(contexto(Panel, 'cambiarPrecio', rol)),
      ).toThrow(ForbiddenException);
    }
  });

  it('E13-H2 · cliente en el panel: cliente y profesional reciben 403', () => {
    for (const rol of [ROLES.CLIENTE, ROLES.PROFESIONAL]) {
      for (const metodo of ['cambiarPrecio', 'consultarStock']) {
        expect(() => guard.canActivate(contexto(Panel, metodo, rol))).toThrow(
          ForbiddenException,
        );
      }
    }
  });

  it('RNF-03 · una ruta sin @RequierePermiso niega el acceso, y sin cuenta autenticada responde 401', () => {
    expect(() =>
      guard.canActivate(contexto(SinPermiso, 'abierta', ROLES.ADMINISTRADOR)),
    ).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contexto(Panel, 'cambiarPrecio'))).toThrow(
      UnauthorizedException,
    );
  });
});
