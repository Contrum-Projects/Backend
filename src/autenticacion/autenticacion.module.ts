import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Entorno } from '../config/entorno.js';
import { ALGORITMO_TOKEN_ACCESO } from './carga-token.js';
import { JwtAutenticacionGuard } from './jwt-autenticacion.guard.js';
import { RevocacionSesiones } from './revocacion-sesiones.js';
import { PermisosGuard } from './permisos.guard.js';

/**
 * Tokens de acceso y su verificación, para todos los módulos: protege una ruta con
 * `@UseGuards(JwtAutenticacionGuard)` y lee la cuenta con `@UsuarioActual()`; para
 * exigir un permiso del panel, `@UseGuards(JwtAutenticacionGuard, PermisosGuard)` con
 * `@RequierePermiso(...)`.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Entorno, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { algorithm: ALGORITMO_TOKEN_ACCESO },
        verifyOptions: { algorithms: [ALGORITMO_TOKEN_ACCESO] },
      }),
    }),
  ],
  providers: [RevocacionSesiones, JwtAutenticacionGuard, PermisosGuard],
  exports: [
    JwtModule,
    RevocacionSesiones,
    JwtAutenticacionGuard,
    PermisosGuard,
  ],
})
export class AutenticacionModule {}
