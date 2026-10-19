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
import { type Permiso, tienePermiso } from '../common/dominio/permisos.js';
import type { UsuarioAutenticado } from './carga-token.js';

const CLAVE_PERMISO = 'permiso';

/** Permiso que exige la ruta o el controlador (RF-13.03). Va con `PermisosGuard`. */
export const RequierePermiso = (permiso: Permiso) =>
  SetMetadata(CLAVE_PERMISO, permiso);

/**
 * Exige que el rol de la cuenta tenga el permiso de `@RequierePermiso(...)` según
 * `PERMISOS_POR_ROL` (RNF-03): 403 si no. Va después de `JwtAutenticacionGuard`, que deja la
 * cuenta en la petición: `@UseGuards(JwtAutenticacionGuard, PermisosGuard)`. Sin
 * `@RequierePermiso` niega el acceso, para que olvidar el decorador no abra la ruta. Cliente y
 * profesional no tienen permisos, así que no entran a ninguna ruta del panel.
 */
@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const permiso = this.reflector.getAllAndOverride<Permiso | undefined>(
      CLAVE_PERMISO,
      [contexto.getHandler(), contexto.getClass()],
    );
    const { usuario } = contexto
      .switchToHttp()
      .getRequest<Request & { usuario?: UsuarioAutenticado }>();
    if (!usuario) throw new UnauthorizedException('Debes iniciar sesión.');
    if (!permiso || !tienePermiso(usuario.rol, permiso)) {
      throw new ForbiddenException('No tienes permiso para esta acción.');
    }
    return true;
  }
}
