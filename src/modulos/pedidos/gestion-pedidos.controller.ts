import {
  Controller,
  Get,
  Param,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAutenticacionGuard } from '../../autenticacion/jwt-autenticacion.guard.js';
import {
  PermisosGuard,
  RequierePermiso,
} from '../../autenticacion/permisos.guard.js';
import { PERMISOS } from '../../common/dominio/permisos.js';
import { CodigoPedidoPipe } from './codigo-pedido.pipe.js';
import {
  DetallePedidoGestionDto,
  ListadoPedidosGestionDto,
} from './dto/gestion-pedidos-respuesta.dto.js';
import { ListarPedidosGestionDto } from './dto/listar-pedidos-gestion.dto.js';
import {
  type DetallePedidoGestion,
  GestionPedidosService,
  type ListadoPedidosGestion,
} from './gestion-pedidos.service.js';

/** Pedidos del panel: lista y detalle para el personal con `pedidos.gestionar` (E8-H2, SCRUM-150). */
@ApiTags('pedidos')
@ApiBearerAuth()
@Controller('gestion/pedidos')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.PEDIDOS_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar pedidos.',
})
export class GestionPedidosController {
  constructor(private readonly gestion: GestionPedidosService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar los pedidos del panel (E8-H2)',
    description:
      'Del más reciente al más antiguo, paginados, del `grupo` pedido (por defecto `por_preparar`: pagados y en preparación; `listos_para_retiro`, `despachados`, `pendientes_pago` y `todos`) y con la búsqueda `q`. Cada pedido trae código, fecha, cliente (razón social si pidió factura), entrega, estado, total con IVA y unidades. `grupos` da los chips en orden con su `cantidad` (`null` en los que no muestran conteo) y `grupo`, el aplicado.',
  })
  @ApiOkResponse({
    description: 'Pedidos, grupos y el grupo aplicado.',
    type: ListadoPedidosGestionDto,
  })
  @ApiBadRequestResponse({
    description: 'Grupo, búsqueda o paginación inválidos.',
  })
  listar(
    @Query() filtros: ListarPedidosGestionDto,
  ): Promise<ListadoPedidosGestion> {
    return this.gestion.listar(filtros);
  }

  @Get(':codigoPedido')
  @ApiOperation({
    summary: 'Ver un pedido desde el panel (E8-H2)',
    description:
      'El detalle del pedido (artículos, montos, entrega, documento) más el cliente (nombre, correo y teléfono), el historial del primero al último con su comentario y quién lo hizo («Sistema», «Cliente» o el nombre del personal), los `cambiosPermitidos` desde el estado actual (con su sentido, si piden código de seguimiento y si avisan al cliente) y `sePuedeCancelar` (solo pendiente de pago).',
  })
  @ApiOkResponse({
    description: 'Detalle del pedido para el personal.',
    type: DetallePedidoGestionDto,
  })
  @ApiNotFoundResponse({ description: 'El pedido no existe.' })
  obtener(
    @Param('codigoPedido', new CodigoPedidoPipe()) codigoPedido: string,
  ): Promise<DetallePedidoGestion> {
    return this.gestion.obtener(codigoPedido);
  }

  @Get(':codigoPedido/etiqueta')
  @ApiOperation({
    summary: 'Descargar la etiqueta de la OT de Chilexpress (SCRUM-153)',
    description:
      'La etiqueta que entregó Chilexpress al crear la OT al despachar, para imprimirla. Su tipo depende de lo que entrega Chilexpress (PDF o imagen).',
  })
  @ApiProduces('application/pdf', 'image/png', 'image/jpeg')
  @ApiOkResponse({ description: 'La etiqueta, como descarga.' })
  @ApiNotFoundResponse({
    description: 'El pedido no existe o su OT no se creó por la API.',
  })
  async etiqueta(
    @Param('codigoPedido', new CodigoPedidoPipe()) codigoPedido: string,
  ): Promise<StreamableFile> {
    const { contenido, tipo, extension } =
      await this.gestion.etiqueta(codigoPedido);
    return new StreamableFile(contenido, {
      type: tipo,
      disposition: `attachment; filename="etiqueta-${codigoPedido}.${extension}"`,
      length: contenido.length,
    });
  }
}
