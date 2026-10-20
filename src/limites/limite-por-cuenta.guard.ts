import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { UsuarioAutenticado } from '../autenticacion/carga-token.js';

/**
 * Como `ThrottlerGuard`, pero cuenta por cuenta (`codigoPublico` del token) en vez de por IP:
 * el límite sigue a la cuenta aunque cambie de red. Va después de `JwtAutenticacionGuard`; sin
 * cuenta en la petición, cuenta por IP. Úsalo con `@Throttle({ default: LIMITES.X })`.
 */
@Injectable()
export class LimitePorCuentaGuard extends ThrottlerGuard {
  protected override async getTracker(
    peticion: Record<string, unknown>,
  ): Promise<string> {
    const usuario = peticion.usuario as UsuarioAutenticado | undefined;
    return usuario
      ? `cuenta:${usuario.codigoPublico}`
      : super.getTracker(peticion);
  }
}
