import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { CookieOptions, Response } from 'express';
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import {
  JwtAutenticacionGuard,
  UsuarioActual,
} from '../../autenticacion/jwt-autenticacion.guard.js';
import type { Entorno } from '../../config/entorno.js';
import { LIMITES } from '../../limites/limites.js';
import { IniciarSesionDto } from './dto/iniciar-sesion.dto.js';
import {
  DemasiadosIntentosException,
  SesionService,
  type SesionIniciada,
} from './sesion.service.js';

/** Cookie httpOnly con el token de refresco; solo viaja a las rutas de sesión. */
export const COOKIE_REFRESCO = 'refresco';
const RUTA_COOKIE_REFRESCO = '/api/cuentas/sesion';

/**
 * Todos los valores de una cookie en la cabecera `Cookie` (la app no usa
 * cookie-parser). Puede venir repetida si otro subdominio plantó una igual.
 */
const leerCookies = (cabecera: string | undefined, nombre: string): string[] =>
  (cabecera?.split(';') ?? []).flatMap((par) => {
    const [clave, ...valor] = par.trim().split('=');
    if (clave !== nombre) return [];
    try {
      const decodificado = decodeURIComponent(valor.join('='));
      return decodificado ? [decodificado] : [];
    } catch {
      return [];
    }
  });

@ApiTags('cuentas')
@Controller('cuentas/sesion')
export class SesionController {
  constructor(
    private readonly sesiones: SesionService,
    private readonly config: ConfigService<Entorno, true>,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Iniciar sesión con correo y contraseña (E1-H2)',
    description:
      'Entrega el token de acceso y el rol, y deja el token de refresco en una cookie httpOnly.',
  })
  @ApiOkResponse({ description: 'Sesión iniciada.' })
  @ApiBadRequestResponse({ description: 'Datos inválidos.' })
  @ApiUnauthorizedResponse({ description: 'Correo o contraseña incorrectos.' })
  @ApiForbiddenResponse({
    description: 'Cuenta desactivada o con el correo sin confirmar.',
  })
  @ApiTooManyRequestsResponse({
    description:
      '5 intentos fallidos del mismo correo (o 20 desde la IP) en 15 minutos.',
  })
  async iniciar(
    @Body() dto: IniciarSesionDto,
    @Ip() ip: string,
    @Headers('user-agent') dispositivo: string | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<SesionIniciada> {
    try {
      const resultado = await this.sesiones.iniciar(dto, { ip, dispositivo });
      respuesta.cookie(COOKIE_REFRESCO, resultado.tokenRefresco, {
        ...this.opcionesCookie(),
        expires: resultado.vencimientoRefresco,
      });
      return resultado.sesion;
    } catch (error) {
      if (error instanceof DemasiadosIntentosException) {
        respuesta.setHeader('Retry-After', String(error.esperaSegundos));
      }
      throw error;
    }
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: LIMITES.CIERRE_SESION })
  @ApiOperation({
    summary: 'Cerrar sesión en este dispositivo (E1-H3)',
    description:
      'Revoca la sesión de la cookie de refresco y la borra; su token de acceso deja de servir de inmediato. Sin cookie o con la sesión ya cerrada responde igual.',
  })
  @ApiNoContentResponse({ description: 'Sesión cerrada.' })
  @ApiTooManyRequestsResponse({
    description: 'Más de 30 cierres por minuto desde la IP.',
  })
  async cerrar(
    @Headers('cookie') cookies: string | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<void> {
    await this.sesiones.cerrar(leerCookies(cookies, COOKIE_REFRESCO));
    respuesta.clearCookie(COOKIE_REFRESCO, this.opcionesCookie());
  }

  @Delete('todas')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAutenticacionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cerrar sesión en todos los dispositivos (E1-H3)',
    description:
      'Revoca todas las sesiones de la cuenta, incluida esta; cada dispositivo deberá iniciar sesión de nuevo.',
  })
  @ApiNoContentResponse({ description: 'Sesiones cerradas.' })
  @ApiUnauthorizedResponse({
    description: 'Sin token de acceso válido o con la sesión ya cerrada.',
  })
  async cerrarTodas(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<void> {
    await this.sesiones.cerrarTodas(usuario.codigoPublico);
    respuesta.clearCookie(COOKIE_REFRESCO, this.opcionesCookie());
  }

  private opcionesCookie(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'strict',
      path: RUTA_COOKIE_REFRESCO,
    };
  }
}
