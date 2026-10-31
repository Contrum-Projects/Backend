import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
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
import { CrearPedidoService } from './crear-pedido.service.js';
import { CrearPedidoDto } from './dto/crear-pedido.dto.js';
import type { DetallePedidoCuenta } from './mis-pedidos.service.js';

/** Confirmación de la compra de la cuenta con la sesión iniciada (E5-H3). */
@ApiTags('pedidos')
@ApiBearerAuth()
@Controller('pedidos')
@UseGuards(JwtAutenticacionGuard, CompradorGuard)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
export class CrearPedidoController {
  constructor(private readonly pedidos: CrearPedidoService) {}

  @Post()
  @UseGuards(LimitePorCuentaGuard)
  @Throttle({ default: LIMITES.CREAR_PEDIDO })
  @ApiOperation({
    summary: 'Crear mi pedido desde el carrito (E5-H3, E5-H4)',
    description:
      'Recalcula precios, IVA y total, crea el pedido, reserva el stock, vacía el carrito y da el plazo para pagar. Repetir la misma `claveIdempotencia` devuelve el mismo pedido. El profesional debe llevar el mínimo de unidades de cada formato (los packs no tienen mínimo). El despacho a domicilio se cotiza con Chilexpress y su costo se suma al total (E7-H2).',
  })
  @ApiCreatedResponse({ description: 'Detalle del pedido.' })
  @ApiBadRequestResponse({ description: 'Datos del pedido inválidos.' })
  @ApiForbiddenResponse({
    description:
      'Cuenta del personal de tienda, o cuenta sin el correo confirmado.',
  })
  @ApiNotFoundResponse({
    description: 'La dirección o los datos de facturación no son de la cuenta.',
  })
  @ApiConflictResponse({
    description:
      'Ya hay un pedido pendiente de pago, carrito vacío o cambiado mientras se cotizaba, artículo que ya no se vende, sin stock, formatos bajo el mínimo del profesional, o despacho sin cobertura de Chilexpress.',
  })
  @ApiServiceUnavailableResponse({
    description:
      'Chilexpress no responde: no se crea el pedido y se ofrece retiro en tienda.',
  })
  @ApiTooManyRequestsResponse({
    description: 'Más de 5 solicitudes por minuto de la misma cuenta.',
  })
  crear(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: CrearPedidoDto,
  ): Promise<DetallePedidoCuenta> {
    return this.pedidos.crear(usuario.codigoPublico, usuario.rol, dto);
  }
}
