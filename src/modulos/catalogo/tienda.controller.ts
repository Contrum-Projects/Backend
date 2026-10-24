import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ListarTiendaDto } from './dto/listar-tienda.dto.js';
import { TiendaService } from './tienda.service.js';

/** Catálogo público: no pide sesión y muestra solo el precio minorista (RNF-04). */
@ApiTags('tienda')
@Controller('tienda')
export class TiendaController {
  constructor(private readonly tienda: TiendaService) {}

  @Get('productos')
  @ApiOperation({
    summary: 'Explorar productos por categoría y marca (E2-H1)',
    description:
      'Productos activos y a la venta, ordenados por nombre y paginados, con imagen, nombre y precio minorista con IVA. Con `categoriaId` incluye los de sus subcategorías; los filtros se combinan.',
  })
  @ApiOkResponse({ description: 'Página de productos con el total.' })
  @ApiBadRequestResponse({ description: 'Filtros inválidos.' })
  @ApiNotFoundResponse({
    description:
      'La categoría no existe, o la marca no existe o no está activa.',
  })
  listarProductos(@Query() filtros: ListarTiendaDto) {
    return this.tienda.listarProductos(filtros);
  }

  @Get('categorias')
  @ApiOperation({
    summary: 'Árbol de categorías de la tienda (E2-H1)',
    description:
      'Categorías raíz con sus subcategorías anidadas, ordenadas por nombre.',
  })
  @ApiOkResponse({ description: 'Árbol de categorías.' })
  listarCategorias() {
    return this.tienda.listarCategorias();
  }

  @Get('marcas')
  @ApiOperation({
    summary: 'Marcas de la tienda (E2-H1)',
    description: 'Marcas activas, ordenadas por nombre.',
  })
  @ApiOkResponse({ description: 'Lista de marcas.' })
  listarMarcas() {
    return this.tienda.listarMarcas();
  }
}
