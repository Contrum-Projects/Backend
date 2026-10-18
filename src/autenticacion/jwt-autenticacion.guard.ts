import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ROLES, type Rol } from '../common/dominio/roles.js';
import {
  ALGORITMO_TOKEN_ACCESO,
  AUDIENCIA_TOKEN_ACCESO,
  type CargaTokenAcceso,
  type UsuarioAutenticado,
} from './carga-token.js';
import { RevocacionSesiones } from './revocacion-sesiones.js';

type PeticionAutenticada = Request & { usuario?: UsuarioAutenticado };

const ROLES_VALIDOS: readonly string[] = Object.values(ROLES);

const esCargaValida = (carga: unknown): carga is CargaTokenAcceso => {
  if (typeof carga !== 'object' || carga === null) return false;
  const { sub, sid, rol } = carga as Record<string, unknown>;
  return (
    typeof sub === 'string' &&
    typeof sid === 'string' &&
    typeof rol === 'string' &&
    ROLES_VALIDOS.includes(rol)
  );
};

/**
 * Exige un token de acceso vigente (`Authorization: Bearer ...`) cuya sesión no
 * esté revocada (RNF-03, RNF-28). Responde 401 si falta, es inválido, caducó o su
 * sesión se cerró. Deja la cuenta en la petición; léela con `@UsuarioActual()`.
 */
@Injectable()
export class JwtAutenticacionGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly revocacion: RevocacionSesiones,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const peticion = contexto.switchToHttp().getRequest<PeticionAutenticada>();
    const [tipo, token] = peticion.headers.authorization?.split(' ') ?? [];
    if (tipo !== 'Bearer' || !token) {
      throw new UnauthorizedException('Debes iniciar sesión.');
    }

    const carga = await this.jwt
      .verifyAsync<object>(token, {
        algorithms: [ALGORITMO_TOKEN_ACCESO],
        audience: AUDIENCIA_TOKEN_ACCESO,
      })
      .catch(() => null);
    if (!esCargaValida(carga)) {
      throw new UnauthorizedException(
        'Tu sesión no es válida o caducó. Inicia sesión de nuevo.',
      );
    }
    if (await this.revocacion.estaRevocada(carga.sid)) {
      throw new UnauthorizedException(
        'Tu sesión se cerró. Inicia sesión de nuevo.',
      );
    }

    peticion.usuario = {
      codigoPublico: carga.sub,
      rol: carga.rol as Rol,
      sesion: carga.sid,
    };
    return true;
  }
}

/** La cuenta autenticada por `JwtAutenticacionGuard`. */
export const UsuarioActual = createParamDecorator(
  (_datos: unknown, contexto: ExecutionContext): UsuarioAutenticado => {
    const { usuario } = contexto
      .switchToHttp()
      .getRequest<PeticionAutenticada>();
    if (!usuario) throw new UnauthorizedException('Debes iniciar sesión.');
    return usuario;
  },
);
