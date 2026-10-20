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
import { AceptarInvitacionDto } from './dto/aceptar-invitacion.dto.js';
import { PersonalService } from './personal.service.js';

/**
 * Ruta pública de la invitación del personal: la persona aún no tiene contraseña, así que se
 * identifica con el token del enlace. Va aparte de `PersonalController` para que este pueda
 * exigir sesión y permiso en toda la clase.
 */
@ApiTags('personal')
@Controller('personal/invitacion')
export class InvitacionPersonalController {
  constructor(private readonly personal: PersonalService) {}

  @Post('aceptar')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: LIMITES.ACEPTAR_INVITACION })
  @ApiOperation({
    summary: 'Definir la contraseña con el enlace de la invitación (E13-H1)',
  })
  @ApiOkResponse({ description: 'Contraseña definida.' })
  @ApiBadRequestResponse({
    description:
      'Contraseña inválida o distinta, o enlace inválido, usado o vencido.',
  })
  @ApiTooManyRequestsResponse({
    description: 'Más de 5 peticiones por minuto desde la misma IP.',
  })
  aceptarInvitacion(@Body() dto: AceptarInvitacionDto) {
    return this.personal.aceptarInvitacion(dto);
  }
}
