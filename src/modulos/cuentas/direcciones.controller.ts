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
  ApiNoContentResponse,
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
import {
  type DireccionCuenta,
  DireccionesService,
} from './direcciones.service.js';
import {
  ActualizarDireccionDto,
  CrearDireccionDto,
} from './dto/guardar-direccion.dto.js';
import { IdDireccionPipe } from './id-direccion.pipe.js';

/**
 * Direcciones de la cuenta con la sesión iniciada. Se identifican por su id, siempre dentro de
 * la cuenta del token: la dirección de otra cuenta responde 404 (decisión del 20 oct).
 */
@ApiTags('cuentas')
@ApiBearerAuth()
@Controller('cuentas/yo/direcciones')
@UseGuards(JwtAutenticacionGuard, CompradorGuard)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
@ApiForbiddenResponse({ description: 'Cuenta del personal de tienda.' })
export class DireccionesController {
  constructor(private readonly direcciones: DireccionesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar mis direcciones (E1-H5)' })
  @ApiOkResponse({ description: 'Direcciones, la principal primero.' })
  listar(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<DireccionCuenta[]> {
    return this.direcciones.listar(usuario.codigoPublico);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Agregar una dirección (E1-H5)',
    description: 'La primera dirección de la cuenta queda como principal.',
  })
  @ApiCreatedResponse({ description: 'Dirección guardada.' })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o comuna inexistente.',
  })
  crear(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: CrearDireccionDto,
  ): Promise<DireccionCuenta> {
    return this.direcciones.crear(usuario.codigoPublico, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar una dirección (E1-H5)' })
  @ApiOkResponse({ description: 'Dirección guardada.' })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o comuna inexistente.',
  })
  @ApiNotFoundResponse({ description: 'La dirección no es de la cuenta.' })
  actualizar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', IdDireccionPipe) id: number,
    @Body() dto: ActualizarDireccionDto,
  ): Promise<DireccionCuenta> {
    return this.direcciones.actualizar(usuario.codigoPublico, id, dto);
  }

  @Patch(':id/principal')
  @ApiOperation({
    summary: 'Marcar una dirección como principal (E1-H5)',
    description: 'Queda como la única principal de la cuenta.',
  })
  @ApiOkResponse({ description: 'Dirección principal.' })
  @ApiNotFoundResponse({ description: 'La dirección no es de la cuenta.' })
  marcarPrincipal(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', IdDireccionPipe) id: number,
  ): Promise<DireccionCuenta> {
    return this.direcciones.marcarPrincipal(usuario.codigoPublico, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Eliminar una dirección (E1-H5)',
    description:
      'Si era la principal, la más reciente de las que quedan pasa a serlo.',
  })
  @ApiNoContentResponse({ description: 'Dirección eliminada.' })
  @ApiNotFoundResponse({ description: 'La dirección no es de la cuenta.' })
  eliminar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', IdDireccionPipe) id: number,
  ): Promise<void> {
    return this.direcciones.eliminar(usuario.codigoPublico, id);
  }
}
