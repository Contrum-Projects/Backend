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
import { IdProductoPipe } from './id-producto.pipe.js';
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
    summary: 'Crear un producto (E3-H1)',
    description:
      'Guarda el producto activo, con su categoría, su marca y su canal de venta (general o profesional). Los formatos, precios e imágenes se agregan en sus propias historias.',
  })
  @ApiCreatedResponse({ description: 'Producto creado.' })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o marca desactivada.',
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
  obtener(@Param('id', IdProductoPipe) id: number) {
    return this.productos.obtener(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Editar un producto (E3-H1)',
    description:
      'Cambia nombre, descripción, categoría, marca o canal de venta. Solo se modifica lo que llega; la marca se puede cambiar pero no quitar.',
  })
  @ApiOkResponse({ description: 'Producto actualizado.' })
  @ApiBadRequestResponse({
    description: 'Datos inválidos, cuerpo vacío o marca desactivada.',
  })
  @ApiNotFoundResponse({
    description: 'El producto, la categoría o la marca no existe.',
  })
  actualizar(
    @Param('id', IdProductoPipe) id: number,
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
  desactivar(@Param('id', IdProductoPipe) id: number) {
    return this.productos.desactivar(id);
  }
}
