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
import { type CarritoCuenta, CarritoService } from './carrito.service.js';
import { ArticulosNavegadorDto } from './dto/articulos-navegador.dto.js';

/**
 * Carrito del visitante (E5-H2): vive en su navegador y la API no lo guarda. Esta ruta es pública
 * y solo calcula; al iniciar sesión se une al de la cuenta con `POST /api/carrito/unir`.
 */
@ApiTags('carrito')
@Controller('carrito')
export class CarritoVisitanteController {
  constructor(private readonly carrito: CarritoService) {}

  @Post('cotizar')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: LIMITES.COTIZAR_CARRITO })
  @ApiTooManyRequestsResponse({
    description: 'Más de 60 cotizaciones por minuto desde la IP.',
  })
  @ApiOperation({
    summary: 'Cotizar el carrito del visitante, sin sesión (E5-H2)',
    description:
      'Recibe los artículos que el visitante guarda en su navegador y devuelve, con la misma forma que `GET /api/carrito`, sus precios con IVA (minorista) y si el stock cubre cada cantidad, sin informar cuántas unidades hay. No guarda nada. Un artículo que no se vende sin cuenta sale con `aLaVenta: false` y sin nombre, tipo ni imagen.',
  })
  @ApiOkResponse({ description: 'Carrito del visitante con sus totales.' })
  @ApiBadRequestResponse({
    description:
      'Lista vacía, con más de 50 artículos, con artículos repetidos o con cantidades inválidas.',
  })
  cotizar(@Body() dto: ArticulosNavegadorDto): Promise<CarritoCuenta> {
    return this.carrito.cotizar(dto.articulos);
  }
}
