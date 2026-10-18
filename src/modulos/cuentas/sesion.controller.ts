import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { Entorno } from '../../config/entorno.js';
import { IniciarSesionDto } from './dto/iniciar-sesion.dto.js';
import {
  DemasiadosIntentosException,
  SesionService,
  type SesionIniciada,
} from './sesion.service.js';

/** Cookie httpOnly con el token de refresco; solo viaja a las rutas de sesión. */
export const COOKIE_REFRESCO = 'refresco';
const RUTA_COOKIE_REFRESCO = '/api/cuentas/sesion';

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
        httpOnly: true,
        secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
        sameSite: 'strict',
        path: RUTA_COOKIE_REFRESCO,
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
}
