import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
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
import { Paginacion } from '../../common/validacion/paginacion.js';
import { ListarTiendaDto } from './dto/listar-tienda.dto.js';
import { ID_PACK, ID_PRODUCTO } from './ids-ruta.js';
import { TiendaDetalleService } from './tienda-detalle.service.js';
import { TiendaPacksService } from './tienda-packs.service.js';
import { TiendaService } from './tienda.service.js';

/**
 * Catálogo público: no pide sesión. Solo el profesional, con su token, ve el precio mayorista
 * y los productos exclusivos (E2-H4, RNF-04), también en el detalle (E2-H3).
 */
@ApiTags('tienda')
@Controller('tienda')
export class TiendaController {
  constructor(
    private readonly tienda: TiendaService,
    private readonly packs: TiendaPacksService,
    private readonly detalle: TiendaDetalleService,
  ) {}

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

  @Get('productos/:id')
  @UseGuards(SesionOpcionalGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Detalle de un producto (E2-H3)',
    description:
      'Producto con su descripción, marca, categoría y sus formatos a la venta (el predeterminado primero). Cada formato trae sus imágenes (la principal primero), el precio minorista con IVA y `disponibilidad`: `disponible` si hay stock en bodegas activas que abastecen la venta online, `agotado` si no; no se informan cantidades. La sesión es opcional: con el token de una cuenta profesional también se ven los productos exclusivos y cada formato trae `precioMayorista` con IVA (`precio` es `null` si el producto es exclusivo). Lo que la tienda no muestra a quien consulta responde 404.',
  })
  @ApiOkResponse({ description: 'Detalle del producto.' })
  @ApiUnauthorizedResponse({
    description:
      'Llegó un token de acceso inválido, vencido o de una sesión cerrada.',
  })
  @ApiNotFoundResponse({
    description:
      'El producto no existe, no está a la venta o es exclusivo para profesionales.',
  })
  obtenerProducto(
    @Param('id', ID_PRODUCTO) id: number,
    @UsuarioOpcional() usuario: UsuarioAutenticado | undefined,
  ) {
    return this.detalle.obtenerProducto(id, usuario?.rol);
  }

  @Get('packs/:id')
  @UseGuards(SesionOpcionalGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Detalle de un pack (E2-H3)',
    description:
      'Pack vigente hoy (hora de Chile) con sus imágenes, precio minorista con IVA, componentes y `disponibilidad`: la de su componente más escaso, contando las unidades de cada formato que lleva el pack. La sesión es opcional: con el token de una cuenta profesional también se ven los packs exclusivos y se recibe `precioMayorista` con IVA y `exclusivo`. Lo que la tienda no muestra a quien consulta responde 404.',
  })
  @ApiOkResponse({ description: 'Detalle del pack.' })
  @ApiUnauthorizedResponse({
    description:
      'Llegó un token de acceso inválido, vencido o de una sesión cerrada.',
  })
  @ApiNotFoundResponse({
    description:
      'El pack no existe, no está vigente, no está a la venta o es exclusivo para profesionales.',
  })
  obtenerPack(
    @Param('id', ID_PACK) id: number,
    @UsuarioOpcional() usuario: UsuarioAutenticado | undefined,
  ) {
    return this.detalle.obtenerPack(id, usuario?.rol);
  }

  @Get('packs')
  @UseGuards(SesionOpcionalGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Packs de la tienda (E3-H6)',
    description:
      'Packs activos, vigentes hoy (hora de Chile) y a la venta, ordenados por nombre y paginados, con imagen, precio minorista con IVA, último día de la promoción y sus componentes. Un pack fuera de su vigencia no se devuelve. La sesión es opcional: con el token de una cuenta profesional se incluyen los packs exclusivos y cada pack trae además `precioMayorista` con IVA y `exclusivo` (`precio` es `null` en los exclusivos).',
  })
  @ApiOkResponse({ description: 'Página de packs con el total.' })
  @ApiBadRequestResponse({ description: 'Paginación inválida.' })
  @ApiUnauthorizedResponse({
    description:
      'Llegó un token de acceso inválido, vencido o de una sesión cerrada.',
  })
  listarPacks(
    @Query() paginacion: Paginacion,
    @UsuarioOpcional() usuario: UsuarioAutenticado | undefined,
  ) {
    return this.packs.listar(paginacion, usuario?.rol);
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
