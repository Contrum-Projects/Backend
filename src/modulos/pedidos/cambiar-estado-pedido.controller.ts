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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import {
  JwtAutenticacionGuard,
  UsuarioActual,
} from '../../autenticacion/jwt-autenticacion.guard.js';
import {
  PermisosGuard,
  RequierePermiso,
} from '../../autenticacion/permisos.guard.js';
import { PERMISOS } from '../../common/dominio/permisos.js';
import {
  type PedidoConNuevoEstado,
  CambiarEstadoPedidoService,
} from './cambiar-estado-pedido.service.js';
import { CambiarEstadoPedidoDto } from './dto/cambiar-estado-pedido.dto.js';

/** Cambio de estado de los pedidos desde el panel: solo el personal con `pedidos.gestionar` (E8-H2). */
@ApiTags('pedidos')
@ApiBearerAuth()
@Controller('pedidos')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.PEDIDOS_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description:
    'El rol no tiene el permiso de gestionar pedidos (los clientes no pueden cambiar el estado).',
})
export class CambiarEstadoPedidoController {
  constructor(private readonly cambioEstado: CambiarEstadoPedidoService) {}

  @Post(':codigoPedido/estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cambiar el estado de un pedido (E8-H2)',
    description:
      'Avanza el pedido por su secuencia (pagado → en preparación → despachado → entregado, o en preparación → listo para retiro → retirado si es retiro en tienda) o lo devuelve un paso con un comentario obligatorio. Al pasar a despachado exige el código de seguimiento de Chilexpress (E7-H3). Guarda el cambio en el historial con fecha, quién lo hizo y el comentario, y en los cambios clave (despachado, listo para retiro, entregado) deja encolado el correo al cliente. La cancelación tiene su propia ruta.',
  })
  @ApiOkResponse({ description: 'Pedido con su nuevo estado.' })
  @ApiBadRequestResponse({
    description:
      'Estado inválido, comentario demasiado largo, falta el comentario al volver a un estado anterior, o el código de seguimiento falta al despachar, es inválido o se envía en otro cambio.',
  })
  @ApiNotFoundResponse({ description: 'El pedido no existe.' })
  @ApiConflictResponse({
    description:
      'El cambio no está permitido desde el estado actual del pedido, o el pedido no tiene los datos del envío.',
  })
  cambiar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('codigoPedido') codigoPedido: string,
    @Body() dto: CambiarEstadoPedidoDto,
  ): Promise<PedidoConNuevoEstado> {
    return this.cambioEstado.cambiar(usuario.codigoPublico, codigoPedido, dto);
  }
}
