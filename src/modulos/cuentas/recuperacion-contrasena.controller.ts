import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { LIMITES } from '../../limites/limites.js';
import { RestablecerContrasenaDto } from './dto/restablecer-contrasena.dto.js';
import { SolicitarRecuperacionDto } from './dto/solicitar-recuperacion.dto.js';
import { RecuperacionContrasenaService } from './recuperacion-contrasena.service.js';

/** Rutas públicas de la recuperación de la contraseña (E1-H4): quien la olvidó no tiene sesión. */
@ApiTags('cuentas')
@Controller('cuentas')
@UseGuards(ThrottlerGuard)
@Throttle({ default: LIMITES.RECUPERAR_CONTRASENA })
@ApiTooManyRequestsResponse({
  description: 'Más de 5 peticiones en 15 minutos desde la misma IP.',
})
export class RecuperacionContrasenaController {
  constructor(private readonly recuperacion: RecuperacionContrasenaService) {}

  @Post('recuperar-contrasena')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Solicitar el enlace para recuperar la contraseña (E1-H4)',
    description:
      'Si el correo es de una cuenta activa, envía un enlace de un uso que vence. La respuesta es la misma aunque el correo no tenga cuenta.',
  })
  @ApiOkResponse({ description: 'Solicitud recibida.' })
  @ApiBadRequestResponse({ description: 'Correo inválido.' })
  solicitar(@Body() dto: SolicitarRecuperacionDto) {
    return this.recuperacion.solicitar(dto.email);
  }

  @Post('restablecer-contrasena')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Definir una contraseña nueva con el enlace de recuperación (E1-H4)',
    description:
      'Deja el enlace sin efecto y cierra todas las sesiones abiertas de la cuenta.',
  })
  @ApiOkResponse({ description: 'Contraseña actualizada.' })
  @ApiBadRequestResponse({
    description:
      'Contraseña inválida o distinta, o enlace inválido, usado o vencido.',
  })
  restablecer(@Body() dto: RestablecerContrasenaDto) {
    return this.recuperacion.restablecer(dto);
  }
}
