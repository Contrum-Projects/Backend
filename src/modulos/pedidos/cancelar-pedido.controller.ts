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
  type PedidoCancelado,
  CancelarPedidoService,
} from './cancelar-pedido.service.js';
import { CancelarPedidoDto } from './dto/cancelar-pedido.dto.js';

/** Cancelación de pedidos desde el panel: solo el personal con `pedidos.gestionar` (E8-H3). */
@ApiTags('pedidos')
@ApiBearerAuth()
@Controller('pedidos')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.PEDIDOS_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description:
    'El rol no tiene el permiso de gestionar pedidos (los clientes no pueden cancelar).',
})
export class CancelarPedidoController {
  constructor(private readonly cancelacion: CancelarPedidoService) {}

  @Post(':codigoPedido/cancelar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancelar un pedido pendiente de pago (E8-H3)',
    description:
      'Deja el pedido cancelado, devuelve su stock a las ubicaciones de donde salió y registra el cambio en el historial con quién lo hizo y el comentario opcional, todo en una transacción. Solo se puede cancelar un pedido pendiente de pago.',
  })
  @ApiOkResponse({ description: 'Pedido cancelado.' })
  @ApiBadRequestResponse({ description: 'Comentario inválido.' })
  @ApiNotFoundResponse({ description: 'El pedido no existe.' })
  @ApiConflictResponse({
    description: 'El pedido no está pendiente de pago (ya pagado o cancelado).',
  })
  cancelar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('codigoPedido') codigoPedido: string,
    @Body() dto: CancelarPedidoDto,
  ): Promise<PedidoCancelado> {
    return this.cancelacion.cancelar(usuario.codigoPublico, codigoPedido, dto);
  }
}
