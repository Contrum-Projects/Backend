import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ROLES, type Rol } from '../common/dominio/roles.js';
import { CompradorGuard } from './comprador.guard.js';

describe('CompradorGuard', () => {
  const guard = new CompradorGuard();

  const contexto = (rol?: Rol) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          usuario: rol ? { codigoPublico: 'x', rol, sesion: 'y' } : undefined,
        }),
      }),
    }) as unknown as ExecutionContext;

  it('deja pasar al cliente y al profesional', () => {
    expect(guard.canActivate(contexto(ROLES.CLIENTE))).toBe(true);
    expect(guard.canActivate(contexto(ROLES.PROFESIONAL))).toBe(true);
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
