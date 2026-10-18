import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES, type Rol } from '../common/dominio/roles.js';
import { Roles, RolesGuard } from './roles.guard.js';

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  class Panel {
    @Roles(ROLES.ADMINISTRADOR)
    soloAdministrador() {}

    sinRoles() {}
  }

  const contexto = (metodo: keyof Panel, rol?: Rol) =>
    ({
      getHandler: () => Panel.prototype[metodo],
      getClass: () => Panel,
      switchToHttp: () => ({
        getRequest: () => ({
          usuario: rol ? { codigoPublico: 'x', rol, sesion: 'y' } : undefined,
        }),
      }),
    }) as unknown as ExecutionContext;

  it('E13-H1 · cuenta creada: el administrador entra a las rutas del panel que le corresponden', () => {
    expect(
      guard.canActivate(contexto('soloAdministrador', ROLES.ADMINISTRADOR)),
    ).toBe(true);
  });

  it('RNF-03 · un rol sin permiso recibe 403', () => {
    for (const rol of [
      ROLES.CLIENTE,
      ROLES.PROFESIONAL,
      ROLES.VENDEDOR,
      ROLES.BODEGUERO,
    ]) {
      expect(() =>
        guard.canActivate(contexto('soloAdministrador', rol)),
      ).toThrow(ForbiddenException);
    }
  });

  it('RNF-03 · una ruta sin @Roles niega el acceso, y sin cuenta autenticada responde 401', () => {
    expect(() =>
      guard.canActivate(contexto('sinRoles', ROLES.ADMINISTRADOR)),
    ).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contexto('soloAdministrador'))).toThrow(
      UnauthorizedException,
    );
  });
});
