import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { UsuarioAutenticado } from './carga-token.js';
import { JwtAutenticacionGuard } from './jwt-autenticacion.guard.js';

type PeticionAutenticada = Request & { usuario?: UsuarioAutenticado };

/**
 * Sesión opcional, para las rutas públicas que cambian según el rol (E2-H4): sin el header
 * `Authorization` la petición pasa como visitante; si llega, el token se revisa igual que en
 * `JwtAutenticacionGuard` y uno inválido, vencido o revocado responde 401, así el frontend
 * renueva la sesión en vez de recibir en silencio lo que ve un visitante. Lee la cuenta con
 * `@UsuarioOpcional()`.
 */
@Injectable()
export class SesionOpcionalGuard implements CanActivate {
  constructor(private readonly jwt: JwtAutenticacionGuard) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const peticion = contexto.switchToHttp().getRequest<Request>();
    if (peticion.headers.authorization === undefined) return true;
    return await this.jwt.canActivate(contexto);
  }
}

/** La cuenta autenticada por `SesionOpcionalGuard`, o `undefined` si es un visitante. */
export const UsuarioOpcional = createParamDecorator(
  (
    _datos: unknown,
    contexto: ExecutionContext,
  ): UsuarioAutenticado | undefined =>
    contexto.switchToHttp().getRequest<PeticionAutenticada>().usuario,
);
