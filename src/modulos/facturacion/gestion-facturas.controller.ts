import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAutenticacionGuard } from '../../autenticacion/jwt-autenticacion.guard.js';
import {
  PermisosGuard,
  RequierePermiso,
} from '../../autenticacion/permisos.guard.js';
import { PERMISOS } from '../../common/dominio/permisos.js';
import { Paginacion } from '../../common/validacion/paginacion.js';
import { CodigoPedidoPipe } from '../pedidos/codigo-pedido.pipe.js';
import {
  type DetalleFacturaGestion,
  GestionFacturasService,
  type ListadoFacturasGestion,
} from './gestion-facturas.service.js';

/** Facturas del panel: lista y datos para emitirlas, con `facturacion.gestionar` (E9-H3, SCRUM-150). */
@ApiTags('facturacion')
@ApiBearerAuth()
@Controller('gestion/facturas')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.FACTURACION_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar la facturación.',
})
export class GestionFacturasController {
  constructor(private readonly facturas: GestionFacturasService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar las facturas del panel (E9-H3)',
    description:
      'Los pedidos pagados (no cancelados) que pidieron factura: primero los por emitir, del pedido más antiguo al más nuevo, y después los emitidos, de la emisión más reciente a la más antigua. Cada uno con razón social, RUT, total con IVA, `estado` (`por_emitir` o `emitida`) y folio. `porEmitir` es el conteo de la pestaña.',
  })
  @ApiOkResponse({
    description: 'Facturas, paginadas, con el conteo por emitir.',
  })
  @ApiBadRequestResponse({ description: 'Paginación inválida.' })
  listar(@Query() paginacion: Paginacion): Promise<ListadoFacturasGestion> {
    return this.facturas.listar(paginacion);
  }

  @Get(':codigoPedido')
  @ApiOperation({
    summary: 'Ver los datos para emitir la factura de un pedido (E9-H3)',
    description:
      'El receptor (razón social, RUT, giro, dirección y comuna), los montos, la tasa de IVA y, si ya se emitió, folio y fecha. Por emitir, los datos de facturación del pedido; emitida, los que copió la factura.',
  })
  @ApiOkResponse({ description: 'Datos de la factura del pedido.' })
  @ApiNotFoundResponse({
    description: 'El pedido no existe, no pidió factura o aún no está pagado.',
  })
  obtener(
    @Param('codigoPedido', new CodigoPedidoPipe()) codigoPedido: string,
  ): Promise<DetalleFacturaGestion> {
    return this.facturas.obtener(codigoPedido);
  }
}
