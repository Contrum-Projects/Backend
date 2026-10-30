import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
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
import { CodigoPedidoPipe } from '../pedidos/codigo-pedido.pipe.js';
import { ConfirmarPagoDto } from './dto/confirmar-pago.dto.js';
import {
  type CobroIniciado,
  type PagoConfirmado,
  PagarPedidoService,
} from './pagar-pedido.service.js';

const CODIGO_PEDIDO = new CodigoPedidoPipe();

/** Pago de un pedido propio en Mercado Pago (E6-H1): solo cliente y profesional. */
@ApiTags('pagos')
@ApiBearerAuth()
@Controller('pedidos')
@UseGuards(JwtAutenticacionGuard, CompradorGuard)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
@ApiForbiddenResponse({ description: 'Cuenta del personal de tienda.' })
@ApiNotFoundResponse({
  description: 'El pedido no existe o no es de esta cuenta.',
})
@ApiServiceUnavailableResponse({
  description: 'Mercado Pago no responde o no está configurado.',
})
@ApiTooManyRequestsResponse({
  description: 'Más de 10 solicitudes por minuto de la misma cuenta.',
})
export class PagarPedidoController {
  constructor(private readonly pagos: PagarPedidoService) {}

  @Post(':codigoPedido/pago')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LimitePorCuentaGuard)
  @Throttle({ default: LIMITES.PAGAR_PEDIDO })
  @ApiOperation({
    summary: 'Ir a pagar un pedido en Mercado Pago (E6-H1)',
    description:
      'Prepara el cobro del total del pedido en Mercado Pago y devuelve la URL donde paga el comprador y la hora límite. Tras un pago rechazado se puede pedir otra vez mientras el pedido siga pendiente de pago y dentro del plazo. No se guardan datos de la tarjeta.',
  })
  @ApiOkResponse({ description: 'URL de pago y hora límite.' })
  @ApiConflictResponse({
    description: 'El pedido ya está pagado, fue cancelado o venció su plazo.',
  })
  iniciar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('codigoPedido', CODIGO_PEDIDO) codigoPedido: string,
  ): Promise<CobroIniciado> {
    return this.pagos.iniciar(usuario.codigoPublico, codigoPedido);
  }

  @Post(':codigoPedido/pago/confirmar')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LimitePorCuentaGuard)
  @Throttle({ default: LIMITES.PAGAR_PEDIDO })
  @ApiOperation({
    summary: 'Confirmar el pago al volver de Mercado Pago (E6-H1)',
    description:
      'Consulta el pago a Mercado Pago y lo registra. Aprobado y por el total: el pedido queda pagado. Rechazado: el pedido sigue pendiente de pago y se puede reintentar dentro del plazo. Confirmar dos veces el mismo pago no cambia nada; un segundo pago aprobado no se acepta.',
  })
  @ApiOkResponse({
    description: 'Estado del pago y detalle del pedido (como en E8-H1).',
  })
  @ApiBadRequestResponse({
    description:
      'Id de pago inválido, el pago no es de este pedido o no es por su total.',
  })
  @ApiConflictResponse({
    description: 'El pedido ya tenía un pago aprobado o fue cancelado.',
  })
  confirmar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('codigoPedido', CODIGO_PEDIDO) codigoPedido: string,
    @Body() dto: ConfirmarPagoDto,
  ): Promise<PagoConfirmado> {
    return this.pagos.confirmar(
      usuario.codigoPublico,
      codigoPedido,
      dto.pagoId,
    );
  }
}
