import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Rol } from '../common/dominio/roles.js';
import type { UsuarioAutenticado } from './carga-token.js';

const CLAVE_ROLES = 'roles';

/** Roles que pueden usar la ruta o el controlador. Va con `RolesGuard`. */
export const Roles = (...roles: Rol[]) => SetMetadata(CLAVE_ROLES, roles);

/**
 * Exige que la cuenta tenga uno de los roles de `@Roles(...)` (RNF-03): 403 si no.
 * Va después de `JwtAutenticacionGuard`, que deja la cuenta en la petición:
 * `@UseGuards(JwtAutenticacionGuard, RolesGuard)`. Sin `@Roles` niega el acceso,
 * para que olvidar el decorador no abra la ruta.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const permitidos = this.reflector.getAllAndOverride<Rol[] | undefined>(
      CLAVE_ROLES,
      [contexto.getHandler(), contexto.getClass()],
    );
    const { usuario } = contexto
      .switchToHttp()
      .getRequest<Request & { usuario?: UsuarioAutenticado }>();
    if (!usuario) throw new UnauthorizedException('Debes iniciar sesión.');
    if (!permitidos?.includes(usuario.rol)) {
      throw new ForbiddenException('No tienes permiso para esta acción.');
    }
    return true;
  }
}
