import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ROLES } from '../common/dominio/roles.js';
import type { UsuarioAutenticado } from './carga-token.js';

export const SOLO_PROFESIONAL =
  'Esta sección es solo para peluqueros con la verificación aprobada.';

/**
 * Deja pasar solo a la cuenta `profesional`, que es la que tiene la verificación aprobada
 * (E10-H4), RNF-03: el cliente y el personal reciben 403. Va después de `JwtAutenticacionGuard`:
 * `@UseGuards(JwtAutenticacionGuard, ProfesionalGuard)`. Un cliente recién aprobado debe renovar la
 * sesión para que su token lleve el rol nuevo.
 */
@Injectable()
export class ProfesionalGuard implements CanActivate {
  canActivate(contexto: ExecutionContext): boolean {
    const { usuario } = contexto
      .switchToHttp()
      .getRequest<Request & { usuario?: UsuarioAutenticado }>();
    if (!usuario) throw new UnauthorizedException('Debes iniciar sesión.');
    if (usuario.rol !== ROLES.PROFESIONAL) {
      throw new ForbiddenException(SOLO_PROFESIONAL);
    }
    return true;
  }
}
