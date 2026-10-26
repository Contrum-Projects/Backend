import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import {
  SesionOpcionalGuard,
  UsuarioOpcional,
} from '../../autenticacion/sesion-opcional.guard.js';
import { ListarTiendaDto } from './dto/listar-tienda.dto.js';
import { TiendaService } from './tienda.service.js';

/**
 * Catálogo público: no pide sesión. Solo el profesional, con su token, ve el precio mayorista
 * y los productos exclusivos (E2-H4, RNF-04).
 */
@ApiTags('tienda')
@Controller('tienda')
export class TiendaController {
  constructor(private readonly tienda: TiendaService) {}

  @Get('productos')
  @UseGuards(SesionOpcionalGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Explorar, buscar y filtrar productos (E2-H1, E2-H2 y E2-H4)',
    description:
      'Productos activos y a la venta, ordenados por nombre y paginados, con imagen, nombre y precio minorista con IVA. Con `categoriaId` incluye los de sus subcategorías. Con `buscar`, cada palabra debe estar en el nombre, la marca o la categoría (propia o superior), sin distinguir mayúsculas. Búsqueda y filtros se combinan; sin coincidencias devuelve una lista vacía. La sesión es opcional: con el token de una cuenta profesional se incluyen los productos exclusivos y cada producto trae además `precioMayorista` con IVA y `exclusivo` (`precio` es `null` en los exclusivos). Visitantes, clientes y personal ven solo los de venta general, sin precio mayorista.',
  })
  @ApiOkResponse({ description: 'Página de productos con el total.' })
  @ApiBadRequestResponse({ description: 'Filtros inválidos.' })
  @ApiUnauthorizedResponse({
    description:
      'Llegó un token de acceso inválido, vencido o de una sesión cerrada.',
  })
  @ApiNotFoundResponse({
    description:
      'La categoría no existe, o la marca no existe o no está activa.',
  })
  listarProductos(
    @Query() filtros: ListarTiendaDto,
    @UsuarioOpcional() usuario: UsuarioAutenticado | undefined,
  ) {
    return this.tienda.listarProductos(filtros, usuario?.rol);
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
