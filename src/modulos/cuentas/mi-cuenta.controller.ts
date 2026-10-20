import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import { CompradorGuard } from '../../autenticacion/comprador.guard.js';
import {
  JwtAutenticacionGuard,
  UsuarioActual,
} from '../../autenticacion/jwt-autenticacion.guard.js';
import { LimitePorCuentaGuard } from '../../limites/limite-por-cuenta.guard.js';
import { LIMITES } from '../../limites/limites.js';
import { ActualizarDatosDto } from './dto/actualizar-datos.dto.js';
import { type DatosPersonales, MiCuentaService } from './mi-cuenta.service.js';

/** Datos personales de la cuenta con la sesión iniciada (cliente y profesional). */
@ApiTags('cuentas')
@ApiBearerAuth()
@Controller('cuentas/yo')
@UseGuards(JwtAutenticacionGuard, CompradorGuard)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
@ApiForbiddenResponse({ description: 'Cuenta del personal de tienda.' })
export class MiCuentaController {
  constructor(private readonly miCuenta: MiCuentaService) {}

  @Get()
  @ApiOperation({ summary: 'Ver mis datos personales (E1-H5)' })
  @ApiOkResponse({ description: 'Datos de la cuenta.' })
  obtener(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<DatosPersonales> {
    return this.miCuenta.obtener(usuario.codigoPublico);
  }

  @Patch()
  @UseGuards(LimitePorCuentaGuard)
  @Throttle({ default: LIMITES.EDITAR_DATOS })
  @ApiOperation({
    summary: 'Editar mis datos personales (E1-H5)',
    description:
      'Guarda solo los datos enviados; null o texto vacío borra un dato opcional. El correo no se edita.',
  })
  @ApiOkResponse({ description: 'Datos guardados; devuelve la cuenta.' })
  @ApiBadRequestResponse({ description: 'Datos inválidos.' })
  @ApiForbiddenResponse({
    description:
      'Cambio de RUT de un profesional o con una verificación en curso.',
  })
  @ApiConflictResponse({ description: 'El RUT está en otra cuenta.' })
  @ApiTooManyRequestsResponse({
    description: 'Más de 10 ediciones por hora en la cuenta.',
  })
  actualizar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: ActualizarDatosDto,
  ): Promise<DatosPersonales> {
    return this.miCuenta.actualizar(usuario.codigoPublico, dto);
  }
}
