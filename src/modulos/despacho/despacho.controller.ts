import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
import {
  type CotizacionDespacho,
  CotizarEnvioService,
} from './cotizar-envio.service.js';
import { CotizarDespachoDto } from './dto/cotizar-despacho.dto.js';

/** El costo del despacho antes de crear el pedido (E7-H2). */
@ApiTags('despacho')
@ApiBearerAuth()
@Controller('despacho')
@UseGuards(JwtAutenticacionGuard, CompradorGuard)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
export class DespachoController {
  constructor(private readonly envios: CotizarEnvioService) {}

  @Get('cotizacion')
  @UseGuards(LimitePorCuentaGuard)
  @Throttle({ default: LIMITES.COTIZAR_ENVIO })
  @ApiOperation({
    summary: 'Cotizar el despacho de mi carrito a una dirección (E7-H2)',
    description:
      'Cotiza con Chilexpress según la comuna, el peso y las medidas, y devuelve el costo con IVA y el total a pagar. Se cobra el servicio más barato. La misma cotización se reutiliza durante 15 minutos.',
  })
  @ApiOkResponse({ description: 'Costo del despacho y total a pagar.' })
  @ApiBadRequestResponse({ description: 'Dirección inválida.' })
  @ApiForbiddenResponse({ description: 'Cuenta del personal de tienda.' })
  @ApiNotFoundResponse({ description: 'La dirección no es de la cuenta.' })
  @ApiConflictResponse({
    description:
      'Carrito vacío, o Chilexpress no tiene servicio para esa comuna y bulto: se ofrece retiro en tienda.',
  })
  @ApiTooManyRequestsResponse({
    description: 'Más de 10 solicitudes por minuto de la misma cuenta.',
  })
  @ApiServiceUnavailableResponse({
    description:
      'Chilexpress no responde: no se puede cotizar en este momento y se ofrece retiro en tienda.',
  })
  cotizar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query() dto: CotizarDespachoDto,
  ): Promise<CotizacionDespacho> {
    return this.envios.cotizarCarrito(usuario.codigoPublico, usuario.rol, dto);
  }
}
