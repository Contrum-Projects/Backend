import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { NotificacionPagoService } from './notificacion-pago.service.js';

/**
 * Notificaciones de Mercado Pago (E6-H2). Es una ruta pública sin JWT: la protege la firma. Sin
 * DTO, porque Mercado Pago envía campos propios que la validación estricta rechazaría; el
 * servicio toma solo los que usa.
 */
@ApiTags('pagos')
@Controller('pagos/notificaciones')
export class NotificacionPagoController {
  constructor(private readonly notificaciones: NotificacionPagoService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recibir una notificación de Mercado Pago (E6-H2)',
    description:
      'Valida la firma (`x-signature`), guarda el evento y responde de inmediato; el pago se consulta a Mercado Pago y se aplica en segundo plano. La misma notificación otra vez no repite cambios ni correos.',
  })
  @ApiOkResponse({ description: 'Notificación recibida o ya registrada.' })
  @ApiBadRequestResponse({
    description: 'Notificación de pago firmada, pero sin sus identificadores.',
  })
  @ApiUnauthorizedResponse({ description: 'Sin una firma válida.' })
  @ApiServiceUnavailableResponse({
    description: 'Falta configurar el secreto de la firma.',
  })
  recibir(
    @Headers('x-signature') firma: unknown,
    @Headers('x-request-id') idSolicitud: unknown,
    @Query('data.id') idPago: unknown,
    @Query('type') tipo: unknown,
    @Body() cuerpo: unknown,
  ): Promise<void> {
    return this.notificaciones.recibir({
      firma,
      idSolicitud,
      idPago,
      tipo,
      cuerpo,
    });
  }
}
