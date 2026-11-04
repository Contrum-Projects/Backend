import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { LIMITES } from '../../limites/limites.js';
import { ConfirmarSuscripcionDto } from './dto/confirmar-suscripcion.dto.js';
import { SuscribirseDto } from './dto/suscribirse.dto.js';
import { SuscripcionesService } from './suscripciones.service.js';

/** Rutas públicas: el visitante se suscribe sin cuenta (E12-H1). */
@ApiTags('marketing')
@Controller('marketing/suscripciones')
@UseGuards(ThrottlerGuard)
@Throttle({ default: LIMITES.SUSCRIPCION })
@ApiTooManyRequestsResponse({
  description: 'Más de 5 peticiones por minuto desde la misma IP.',
})
export class SuscripcionesController {
  constructor(private readonly suscripciones: SuscripcionesService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Suscribirse a las ofertas sin cuenta (E12-H1)',
    description:
      'Registra la suscripción inactiva y envía el enlace de confirmación. Responde lo mismo si el correo ya estaba suscrito.',
  })
  @ApiAcceptedResponse({ description: 'Solicitud recibida.' })
  @ApiBadRequestResponse({ description: 'Correo inválido.' })
  suscribir(@Body() dto: SuscribirseDto) {
    return this.suscripciones.suscribir(dto.email);
  }

  @Post('confirmar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirmar la suscripción con el token del enlace (E12-H1)',
  })
  @ApiOkResponse({ description: 'Suscripción activa.' })
  @ApiBadRequestResponse({
    description: 'Enlace inválido, vencido o anterior a una baja.',
  })
  confirmar(@Body() dto: ConfirmarSuscripcionDto) {
    return this.suscripciones.confirmar(dto.token);
  }
}
