import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { RebotesService } from './rebotes.service.js';

/**
 * Avisos de Resend (E12-H6 · CA2). Es una ruta pública sin JWT: la protege la firma. Sin DTO,
 * porque Resend envía campos propios que la validación estricta rechazaría y la firma se calcula
 * sobre el cuerpo tal como llegó (`rawBody`); el servicio toma solo los campos que usa. Sin límite
 * por IP, como el aviso de Mercado Pago: Resend envía muchos seguidos tras una campaña.
 */
@ApiTags('marketing')
@Controller('marketing/rebotes')
export class RebotesController {
  constructor(private readonly rebotes: RebotesService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recibir un aviso de rebote de Resend (E12-H6)',
    description:
      'Webhook de Resend con el evento `email.bounced`; valida la firma (`svix-id`, `svix-timestamp`, `svix-signature`). Marca el correo como `rebotada` y deja su dirección sin publicidad, como la baja. Otros eventos se ignoran. El mismo aviso otra vez no cambia nada.',
  })
  @ApiOkResponse({ description: 'Aviso recibido.' })
  @ApiUnauthorizedResponse({ description: 'Sin una firma válida.' })
  @ApiServiceUnavailableResponse({
    description: 'Falta configurar el secreto del webhook.',
  })
  recibir(
    @Req() peticion: RawBodyRequest<Request>,
    @Headers('svix-id') id: unknown,
    @Headers('svix-timestamp') marcaTiempo: unknown,
    @Headers('svix-signature') firma: unknown,
  ): Promise<void> {
    return this.rebotes.recibir({
      cuerpo: peticion.rawBody,
      id,
      marcaTiempo,
      firma,
    });
  }
}
