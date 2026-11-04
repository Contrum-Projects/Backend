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
import { BajasService } from './bajas.service.js';
import { DarDeBajaDto } from './dto/dar-de-baja.dto.js';
import type { Mensaje } from './suscripciones.service.js';

/** Ruta pública: se llega desde el enlace de baja de un correo publicitario (E12-H2). */
@ApiTags('marketing')
@Controller('marketing/bajas')
@UseGuards(ThrottlerGuard)
@Throttle({ default: LIMITES.SUSCRIPCION })
export class BajasController {
  constructor(private readonly bajas: BajasService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dejar de recibir publicidad con el enlace del correo (E12-H2)',
    description:
      'Da de baja la dirección del enlace, sea de una cuenta o de un suscriptor. Responde lo mismo si ya estaba de baja.',
  })
  @ApiOkResponse({ description: 'La dirección ya no recibe publicidad.' })
  @ApiBadRequestResponse({ description: 'Enlace inválido.' })
  @ApiTooManyRequestsResponse({
    description: 'Más de 5 peticiones por minuto desde la misma IP.',
  })
  darDeBaja(@Body() dto: DarDeBajaDto): Promise<Mensaje> {
    return this.bajas.darDeBaja(dto.token);
  }
}
