import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ROLES_COMPRADOR } from '../common/dominio/roles.js';
import type { UsuarioAutenticado } from './carga-token.js';

/**
 * Deja pasar solo a las cuentas que compran en la tienda (cliente y profesional), RNF-03: el
 * personal recibe 403 en las rutas de «mi cuenta». Va después de `JwtAutenticacionGuard`:
 * `@UseGuards(JwtAutenticacionGuard, CompradorGuard)`.
 */
@Injectable()
export class CompradorGuard implements CanActivate {
  canActivate(contexto: ExecutionContext): boolean {
    const { usuario } = contexto
      .switchToHttp()
      .getRequest<Request & { usuario?: UsuarioAutenticado }>();
    if (!usuario) throw new UnauthorizedException('Debes iniciar sesión.');
    if (!ROLES_COMPRADOR.includes(usuario.rol)) {
      throw new ForbiddenException(
        'Esta sección es solo para cuentas de clientes de la tienda.',
      );
    }
    return true;
  }
}
