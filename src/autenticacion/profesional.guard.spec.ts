import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ROLES, type Rol } from '../common/dominio/roles.js';
import { ProfesionalGuard } from './profesional.guard.js';

describe('ProfesionalGuard', () => {
  const guard = new ProfesionalGuard();

  const contexto = (rol?: Rol) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          usuario: rol ? { codigoPublico: 'x', rol, sesion: 'y' } : undefined,
        }),
      }),
    }) as unknown as ExecutionContext;

  it('deja pasar al profesional', () => {
    expect(guard.canActivate(contexto(ROLES.PROFESIONAL))).toBe(true);
  });

  it('E10-H5 · cuenta sin verificar: responde 403 al cliente', () => {
    expect(() => guard.canActivate(contexto(ROLES.CLIENTE))).toThrow(
      ForbiddenException,
    );
  });

  it('responde 403 al personal de tienda', () => {
    for (const rol of [ROLES.VENDEDOR, ROLES.BODEGUERO, ROLES.ADMINISTRADOR]) {
      expect(() => guard.canActivate(contexto(rol))).toThrow(
        ForbiddenException,
      );
    }
  });

  it('responde 401 si no hay cuenta en la petición', () => {
    expect(() => guard.canActivate(contexto())).toThrow(UnauthorizedException);
  });
});
