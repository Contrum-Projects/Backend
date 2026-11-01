import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import { CompradorGuard } from '../../autenticacion/comprador.guard.js';
import {
  JwtAutenticacionGuard,
  UsuarioActual,
} from '../../autenticacion/jwt-autenticacion.guard.js';
import { Paginacion } from '../../common/validacion/paginacion.js';
import { CodigoPedidoPipe } from './codigo-pedido.pipe.js';
import {
  type DetallePedidoCuenta,
  type HistorialPedidos,
  MisPedidosService,
} from './mis-pedidos.service.js';

const CODIGO_PEDIDO = new CodigoPedidoPipe();

/** Pedidos de la cuenta con la sesión iniciada: siempre los del token (E8-H1). */
@ApiTags('pedidos')
@ApiBearerAuth()
@Controller('pedidos')
@UseGuards(JwtAutenticacionGuard, CompradorGuard)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
@ApiForbiddenResponse({ description: 'Cuenta del personal de tienda.' })
export class MisPedidosController {
  constructor(private readonly pedidos: MisPedidosService) {}

  @Get()
  @ApiOperation({
    summary: 'Ver mi historial de pedidos (E8-H1)',
    description:
      'Los pedidos de la cuenta, del más reciente al más antiguo, con fecha, total con IVA y estado actual. Paginado con `pagina` y `limite`.',
  })
  @ApiOkResponse({
    description: 'Página de pedidos con el total; vacía si no tiene.',
  })
  @ApiBadRequestResponse({ description: 'Paginación inválida.' })
  listar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query() paginacion: Paginacion,
  ): Promise<HistorialPedidos> {
    return this.pedidos.listar(usuario.codigoPublico, paginacion);
  }

  @Get(':codigoPedido')
  @ApiOperation({
    summary: 'Ver el detalle de un pedido mío (E8-H1, E9-H1)',
    description:
      'Artículos con su precio con IVA, montos, forma de entrega (con la dirección y el seguimiento si es despacho) y cambios de estado con su fecha. Con boleta y pago aprobado, `idTransaccionPago` es la referencia del comprobante de Mercado Pago. Un pedido de otra cuenta responde 404, igual que uno que no existe.',
  })
  @ApiOkResponse({ description: 'Detalle del pedido.' })
  @ApiNotFoundResponse({
    description: 'El pedido no existe o no es de esta cuenta.',
  })
  obtener(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('codigoPedido', CODIGO_PEDIDO) codigoPedido: string,
  ): Promise<DetallePedidoCuenta> {
    return this.pedidos.obtener(usuario.codigoPublico, codigoPedido);
  }
}
