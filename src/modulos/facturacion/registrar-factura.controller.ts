import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
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
import { RegistrarFacturaDto } from './dto/registrar-factura.dto.js';
import {
  type ArchivoSubido,
  type FacturaRegistrada,
  RegistrarFacturaService,
} from './registrar-factura.service.js';
import {
  CAMPO_FACTURA,
  SubidaFacturaInterceptor,
} from './subida-factura.interceptor.js';

/** Registro de la factura emitida en el SII: solo el personal con `facturacion.gestionar` (E9-H3). */
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
export class RegistrarFacturaController {
  constructor(private readonly facturas: RegistrarFacturaService) {}

  @Post(':codigoPedido/factura')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(SubidaFacturaInterceptor)
  @ApiOperation({
    summary: 'Registrar la factura emitida en el SII (E9-H3)',
    description:
      'Recibe el PDF de la factura en el campo `archivo` (hasta 5 MB, reconocido por su contenido), el `folio` y, opcionalmente, la `fechaEmision` (AAAA-MM-DD, no futura; por defecto hoy). Guarda el documento con los datos del receptor y los montos del pedido tal como están al registrarlo. El pedido debe estar pagado y haber pedido factura; tiene una sola factura y el folio no puede repetirse. El archivo es privado: no se devuelve en la respuesta.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [CAMPO_FACTURA, 'folio'],
      properties: {
        [CAMPO_FACTURA]: { type: 'string', format: 'binary' },
        folio: { type: 'integer', minimum: 1, example: 4521 },
        fechaEmision: { type: 'string', example: '2026-10-30' },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Factura registrada.' })
  @ApiBadRequestResponse({
    description:
      'Sin PDF, el archivo no es un PDF, o el folio o la fecha no son válidos.',
  })
  @ApiNotFoundResponse({ description: 'El pedido no existe.' })
  @ApiConflictResponse({
    description:
      'El pedido no pidió factura, no está pagado, ya tiene factura, o el folio ya existe.',
  })
  @ApiPayloadTooLargeResponse({ description: 'El PDF supera los 5 MB.' })
  @ApiServiceUnavailableResponse({
    description: 'El almacén de archivos no está configurado o no responde.',
  })
  registrar(
    @Param('codigoPedido', new CodigoPedidoPipe()) codigoPedido: string,
    @Body() dto: RegistrarFacturaDto,
    @UploadedFile() archivo: ArchivoSubido | undefined,
  ): Promise<FacturaRegistrada> {
    return this.facturas.registrar(codigoPedido, dto, archivo);
  }
}
