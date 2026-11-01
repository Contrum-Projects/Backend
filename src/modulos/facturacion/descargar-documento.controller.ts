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
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import { CompradorGuard } from '../../autenticacion/comprador.guard.js';
import {
  JwtAutenticacionGuard,
  UsuarioActual,
} from '../../autenticacion/jwt-autenticacion.guard.js';
import { CodigoPedidoPipe } from '../pedidos/codigo-pedido.pipe.js';
import { DescargarDocumentoService } from './descargar-documento.service.js';
import { comoDescargaPdf } from './descarga-pdf.js';

/** Descarga del documento tributario del pedido: solo su dueño (E9-H4). */
@ApiTags('facturacion')
@ApiBearerAuth()
@Controller('pedidos')
@UseGuards(JwtAutenticacionGuard, CompradorGuard)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
@ApiForbiddenResponse({ description: 'Cuenta del personal de tienda.' })
export class DescargarDocumentoController {
  constructor(private readonly documentos: DescargarDocumentoService) {}

  @Get(':codigoPedido/documento')
  @HttpCode(HttpStatus.OK)
  // Un documento tributario no debe quedar en cachés compartidas ni interpretarse como otro tipo
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'Descargar el documento tributario de mi pedido (E9-H4)',
    description:
      'Entrega el PDF de la factura registrada del pedido, como descarga. Un pedido de otra cuenta responde 404, igual que uno que no existe. Mientras la factura no se registre responde 404 sin archivo: el detalle del pedido (`GET /api/pedidos/:codigoPedido`) indica entonces que el documento está pendiente.',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'El PDF de la factura.' })
  @ApiNotFoundResponse({
    description:
      'El pedido no existe o no es de esta cuenta, o su factura aún no está registrada.',
  })
  @ApiServiceUnavailableResponse({
    description: 'El almacén de archivos no está configurado o no responde.',
  })
  async descargar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('codigoPedido', new CodigoPedidoPipe()) codigoPedido: string,
  ): Promise<StreamableFile> {
    const archivo = await this.documentos.descargar(
      usuario.codigoPublico,
      codigoPedido,
    );
    return comoDescargaPdf(archivo);
  }
}
