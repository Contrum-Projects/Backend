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
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
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
import { CuponCarritoService } from './cupon-carrito.service.js';
import { CuponCarritoDto } from './dto/cupon-respuesta.dto.js';
import { ValidarCuponDto } from './dto/cupon.dto.js';

/** Probar un cupón sobre el carrito de la cuenta antes de pagar (SCRUM-150). */
@ApiTags('carrito')
@ApiBearerAuth()
@Controller('carrito/cupon')
@UseGuards(JwtAutenticacionGuard, CompradorGuard)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
@ApiForbiddenResponse({ description: 'Cuenta del personal de tienda.' })
export class CuponCarritoController {
  constructor(private readonly cupones: CuponCarritoService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(LimitePorCuentaGuard)
  @Throttle({ default: LIMITES.VALIDAR_CUPON })
  @ApiOperation({
    summary: 'Ver cuánto descuenta un cupón en mi carrito (SCRUM-150)',
    description:
      'Revisa el código con las mismas reglas que el pedido (vigencia, campaña, usos, rol, compra mínima y lo que cubre) y devuelve el descuento con IVA. No reserva el cupón: se aplica al crear el pedido con `codigoCupon`.',
  })
  @ApiOkResponse({ type: CuponCarritoDto })
  @ApiBadRequestResponse({
    description:
      'El cupón no existe, no está vigente, no es para la cuenta, se agotó o no aplica al carrito; el mensaje va en el campo `codigoCupon`.',
  })
  validar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: ValidarCuponDto,
  ): Promise<CuponCarritoDto> {
    return this.cupones.validar(usuario.codigoPublico, usuario.rol, dto.codigo);
  }
}
