import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAutenticacionGuard } from '../../autenticacion/jwt-autenticacion.guard.js';
import {
  PermisosGuard,
  RequierePermiso,
} from '../../autenticacion/permisos.guard.js';
import { PERMISOS } from '../../common/dominio/permisos.js';
import { CodigoPedidoPipe } from '../pedidos/codigo-pedido.pipe.js';
import { DescargarDocumentoService } from './descargar-documento.service.js';
import { comoDescargaPdf } from './descarga-pdf.js';

/** Descarga de la factura de cualquier pedido por el personal con `facturacion.gestionar` (E9-H4). */
@ApiTags('facturacion')
@ApiBearerAuth()
@Controller('pedidos')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.FACTURACION_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description:
    'El rol no tiene el permiso de gestionar la facturación (solo vendedor y administrador).',
})
export class DescargarFacturaPersonalController {
  constructor(private readonly documentos: DescargarDocumentoService) {}

  @Get(':codigoPedido/factura')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'Descargar la factura registrada de un pedido (E9-H4)',
    description:
      'Entrega el PDF de la factura registrada con `POST /api/pedidos/:codigoPedido/factura`, como descarga, para verificar lo que se subió. Sirve para cualquier pedido. Mientras la factura no se registre responde 404 sin archivo.',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'El PDF de la factura.' })
  @ApiNotFoundResponse({
    description: 'El pedido no existe o su factura aún no está registrada.',
  })
  @ApiServiceUnavailableResponse({
    description: 'El almacén de archivos no está configurado o no responde.',
  })
  async descargar(
    @Param('codigoPedido', new CodigoPedidoPipe()) codigoPedido: string,
  ): Promise<StreamableFile> {
    return comoDescargaPdf(
      await this.documentos.descargarComoPersonal(codigoPedido),
    );
  }
}
