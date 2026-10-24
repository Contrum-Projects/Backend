import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { ActualizarFormatoDto } from './dto/actualizar-formato.dto.js';
import { CrearFormatoDto } from './dto/crear-formato.dto.js';
import { FormatosService } from './formatos.service.js';
import { IdFormatoPipe } from './id-formato.pipe.js';
import { IdProductoPipe } from './id-producto.pipe.js';

@ApiTags('catalogo')
@ApiBearerAuth()
@Controller('catalogo')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.CATALOGO_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar el catálogo.',
})
export class FormatosController {
  constructor(private readonly formatos: FormatosService) {}

  @Post('productos/:id/formatos')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Agregar un formato de venta a un producto (E3-H2)',
    description:
      'Guarda el formato activo, con su SKU, código de barras, contenido, peso, medidas, stock mínimo y fecha de vencimiento opcional. Nace sin precios (se fijan en E3-H5). El primer formato del producto queda como predeterminado.',
  })
  @ApiCreatedResponse({ description: 'Formato creado.' })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o contenido sin su unidad de medida.',
  })
  @ApiNotFoundResponse({ description: 'El producto no existe.' })
  @ApiConflictResponse({
    description: 'El SKU o el código de barras ya pertenece a otro artículo.',
  })
  crear(
    @Param('id', IdProductoPipe) productoId: number,
    @Body() dto: CrearFormatoDto,
  ) {
    return this.formatos.crear(productoId, dto);
  }

  @Get('productos/:id/formatos')
  @ApiOperation({
    summary: 'Listar los formatos de un producto (E3-H2)',
    description:
      'Incluye la fecha de vencimiento, que solo se muestra en el panel. El predeterminado va primero.',
  })
  @ApiOkResponse({ description: 'Formatos del producto.' })
  @ApiNotFoundResponse({ description: 'El producto no existe.' })
  listar(@Param('id', IdProductoPipe) productoId: number) {
    return this.formatos.listar(productoId);
  }

  @Patch('formatos/:id')
  @ApiOperation({
    summary: 'Editar un formato de venta (E3-H2)',
    description:
      'Solo se modifica lo que llega; `null` borra el código de barras, el contenido con su unidad o la fecha de vencimiento. Con `esPredeterminado: true` queda como el único predeterminado del producto.',
  })
  @ApiOkResponse({ description: 'Formato actualizado.' })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, cuerpo vacío, contenido sin su unidad o intento de desmarcar el predeterminado.',
  })
  @ApiNotFoundResponse({ description: 'El formato no existe.' })
  @ApiConflictResponse({
    description: 'El SKU o el código de barras ya pertenece a otro artículo.',
  })
  actualizar(
    @Param('id', IdFormatoPipe) id: number,
    @Body() dto: ActualizarFormatoDto,
  ) {
    return this.formatos.actualizar(id, dto);
  }
}
