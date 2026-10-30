import {
  Body,
  Controller,
  Delete,
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
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import { CompradorGuard } from '../../autenticacion/comprador.guard.js';
import {
  JwtAutenticacionGuard,
  UsuarioActual,
} from '../../autenticacion/jwt-autenticacion.guard.js';
import { IdRutaPipe } from '../../common/validacion/id-ruta.pipe.js';
import {
  type CarritoCuenta,
  CarritoService,
  type CarritoUnido,
} from './carrito.service.js';
import {
  AgregarArticuloCarritoDto,
  CambiarCantidadCarritoDto,
} from './dto/articulo-carrito.dto.js';
import { ArticulosNavegadorDto } from './dto/articulos-navegador.dto.js';

const ID_ARTICULO = new IdRutaPipe('El artículo no está en el carrito.');

/**
 * Carrito de la cuenta con la sesión iniciada: uno por cuenta, siempre el del token. El del
 * visitante vive en el navegador y se une a este al iniciar sesión (E5-H2).
 */
@ApiTags('carrito')
@ApiBearerAuth()
@Controller('carrito')
@UseGuards(JwtAutenticacionGuard, CompradorGuard)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
@ApiForbiddenResponse({ description: 'Cuenta del personal de tienda.' })
export class CarritoController {
  constructor(private readonly carrito: CarritoService) {}

  @Get()
  @ApiOperation({
    summary: 'Ver mi carrito con totales (E5-H1, E5-H4)',
    description:
      'Líneas con precio unitario y subtotal con IVA, calculados al consultar según el rol (el profesional ve el mayorista), y el total. Cada línea indica si el artículo sigue a la venta, si el stock cubre la cantidad (sin informar cuántas unidades hay) y, para el profesional, si un formato está bajo el mínimo (`bajoMinimo`); en esos casos `impideCrearPedido` es `true` hasta que se quite o se ajuste la cantidad.',
  })
  @ApiOkResponse({ description: 'Carrito de la cuenta; vacío si no tiene.' })
  obtener(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CarritoCuenta> {
    return this.carrito.obtener(usuario.codigoPublico, usuario.rol);
  }

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Agregar un artículo al carrito (E5-H1)',
    description:
      'Suma las unidades a las que el carrito ya tenga de ese artículo (formato o pack). El artículo debe venderse hoy a la cuenta y el stock debe cubrir la cantidad resultante. Devuelve el carrito con sus totales.',
  })
  @ApiCreatedResponse({ description: 'Carrito actualizado.' })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, el artículo no existe o no está a la venta, o el stock no alcanza.',
  })
  agregar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: AgregarArticuloCarritoDto,
  ): Promise<CarritoCuenta> {
    return this.carrito.agregar(usuario.codigoPublico, usuario.rol, dto);
  }

  @Patch('items/:articuloId')
  @ApiOperation({
    summary: 'Cambiar la cantidad de un artículo del carrito (E5-H1)',
    description:
      'Deja el artículo con la cantidad indicada, que debe cubrir el stock. Devuelve el carrito con sus totales recalculados.',
  })
  @ApiOkResponse({ description: 'Carrito actualizado.' })
  @ApiBadRequestResponse({
    description:
      'Cantidad inválida, el artículo ya no está a la venta o el stock no alcanza.',
  })
  @ApiNotFoundResponse({ description: 'El artículo no está en el carrito.' })
  cambiarCantidad(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('articuloId', ID_ARTICULO) articuloId: number,
    @Body() dto: CambiarCantidadCarritoDto,
  ): Promise<CarritoCuenta> {
    return this.carrito.cambiarCantidad(
      usuario.codigoPublico,
      usuario.rol,
      articuloId,
      dto,
    );
  }

  @Delete('items/:articuloId')
  @ApiOperation({
    summary: 'Quitar un artículo del carrito (E5-H1)',
    description:
      'Lo elimina aunque ya no se venda y devuelve el carrito con sus totales recalculados.',
  })
  @ApiOkResponse({ description: 'Carrito actualizado.' })
  @ApiNotFoundResponse({ description: 'El artículo no está en el carrito.' })
  quitar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('articuloId', ID_ARTICULO) articuloId: number,
  ): Promise<CarritoCuenta> {
    return this.carrito.quitar(usuario.codigoPublico, usuario.rol, articuloId);
  }

  @Post('unir')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unir el carrito del navegador al de la cuenta (E5-H2)',
    description:
      'Se llama al iniciar sesión con los artículos que el visitante guardó en su navegador. Un artículo que ya estaba en la cuenta suma sus unidades. Lo que no se vende a la cuenta o está agotado se descarta, y una suma sobre 999 queda en 999; cada caso va en `ajustes`. Una cantidad mayor al stock se une sin recortar (recortarla revelaría cuántas unidades hay) y la línea queda con `impideCrearPedido` hasta ajustarla; lo mismo un formato bajo el mínimo del profesional (`bajoMinimo`). Devuelve el carrito de la cuenta con sus totales. Después de unir, el navegador debe vaciar su carrito.',
  })
  @ApiOkResponse({ description: 'Carrito de la cuenta con la unión.' })
  @ApiBadRequestResponse({
    description:
      'Lista vacía, con más de 50 artículos, con artículos repetidos o con cantidades inválidas.',
  })
  unir(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: ArticulosNavegadorDto,
  ): Promise<CarritoUnido> {
    return this.carrito.unir(usuario.codigoPublico, usuario.rol, dto.articulos);
  }
}
