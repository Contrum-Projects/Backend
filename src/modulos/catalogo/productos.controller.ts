import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
import { ActualizarProductoDto } from './dto/actualizar-producto.dto.js';
import { CrearProductoDto } from './dto/crear-producto.dto.js';
import { ListarProductosDto } from './dto/listar-productos.dto.js';
import { ID_PRODUCTO } from './ids-ruta.js';
import { ProductosService } from './productos.service.js';

@ApiTags('catalogo')
@ApiBearerAuth()
@Controller('catalogo/productos')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.CATALOGO_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar el catálogo.',
})
export class ProductosController {
  constructor(private readonly productos: ProductosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear un producto (E3-H1, E4-H2)',
    description:
      'Guarda el producto activo, con su categoría, su marca y su canal de venta (general o profesional). Los formatos, precios e imágenes se agregan en sus propias historias. Si la descripción partió de una sugerencia de la IA, envía `sugerencia` (texto sugerido y su firma): igual a la sugerida queda con origen «ia» y cambiada con «ia_editada»; sin `sugerencia` es «manual». La sugerencia nunca se guarda sola: solo lo que se envía aquí.',
  })
  @ApiCreatedResponse({ description: 'Producto creado.' })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, marca desactivada o sugerencia con una firma que no corresponde.',
  })
  @ApiNotFoundResponse({ description: 'La categoría o la marca no existe.' })
  crear(@Body() dto: CrearProductoDto) {
    return this.productos.crear(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar productos',
    description:
      'Por defecto solo los activos, ordenados por nombre y paginados. Se puede filtrar por texto, categoría y marca.',
  })
  @ApiOkResponse({ description: 'Página de productos con el total.' })
  @ApiBadRequestResponse({ description: 'Filtros inválidos.' })
  listar(@Query() filtros: ListarProductosDto) {
    return this.productos.listar(filtros);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver un producto' })
  @ApiOkResponse({ description: 'Producto con su marca y categoría.' })
  @ApiNotFoundResponse({ description: 'El producto no existe.' })
  obtener(@Param('id', ID_PRODUCTO) id: number) {
    return this.productos.obtener(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Editar un producto (E3-H1, E4-H2)',
    description:
      'Cambia nombre, descripción, ingredientes, categoría, marca o canal de venta. Solo se modifica lo que llega; la marca se puede cambiar pero no quitar. Con `sugerencia` (exige `descripcion`) el origen se decide como al crear; sin ella, una descripción de origen «ia» que cambia pasa a «ia_editada».',
  })
  @ApiOkResponse({ description: 'Producto actualizado.' })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, cuerpo vacío, marca desactivada, sugerencia sin descripción o con una firma que no corresponde.',
  })
  @ApiNotFoundResponse({
    description: 'El producto, la categoría o la marca no existe.',
  })
  actualizar(
    @Param('id', ID_PRODUCTO) id: number,
    @Body() dto: ActualizarProductoDto,
  ) {
    return this.productos.actualizar(id, dto);
  }

  @Patch(':id/desactivar')
  @ApiOperation({
    summary: 'Desactivar un producto (E3-H1)',
    description:
      'El producto deja de mostrarse en la tienda, pero no se borra. Repetir la acción no cambia nada.',
  })
  @ApiOkResponse({ description: 'Producto desactivado.' })
  @ApiNotFoundResponse({ description: 'El producto no existe.' })
  desactivar(@Param('id', ID_PRODUCTO) id: number) {
    return this.productos.desactivar(id);
  }
}
