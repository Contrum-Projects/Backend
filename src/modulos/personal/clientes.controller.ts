import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import {
  JwtAutenticacionGuard,
  UsuarioActual,
} from '../../autenticacion/jwt-autenticacion.guard.js';
import {
  PermisosGuard,
  RequierePermiso,
} from '../../autenticacion/permisos.guard.js';
import { PERMISOS } from '../../common/dominio/permisos.js';
import { ClientesService } from './clientes.service.js';
import {
  ClienteDetalleDto,
  ListadoClientesDto,
} from './dto/cliente-respuesta.dto.js';
import { ListarClientesDto } from './dto/listar-clientes.dto.js';

const codigoPublico = new ParseUUIDPipe();

/**
 * Panel: cuentas de clientes y profesionales (E13-H4). Solo el administrador
 * (`personal.gestionar`, como el cambio de rol). Los guards van en la clase para que una ruta
 * nueva quede protegida aunque se olvide decorarla.
 */
@ApiTags('clientes')
@ApiBearerAuth()
@Controller('clientes')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.PERSONAL_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
@ApiForbiddenResponse({ description: 'Solo el administrador.' })
export class ClientesController {
  constructor(private readonly clientes: ClientesService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar clientes y profesionales (E13-H4)',
    description:
      'Paginado, más recientes primero. Busca en el nombre, el apellido, el correo o el RUT y filtra por rol y estado; `conteos` son los números de los filtros con la búsqueda aplicada.',
  })
  @ApiOkResponse({ type: ListadoClientesDto })
  @ApiBadRequestResponse({ description: 'Filtros inválidos.' })
  listar(@Query() filtros: ListarClientesDto): Promise<ListadoClientesDto> {
    return this.clientes.listar(filtros);
  }

  @Get(':codigoPublico')
  @ApiOperation({
    summary: 'Ver una cuenta de cliente o profesional (E13-H4)',
    description:
      'Sus datos, el perfil profesional, la solicitud de verificación más reciente, cuántos pedidos creó y su historial de rol.',
  })
  @ApiParam({ name: 'codigoPublico', description: 'UUID de la cuenta.' })
  @ApiOkResponse({ type: ClienteDetalleDto })
  @ApiBadRequestResponse({ description: 'El código no es válido.' })
  @ApiNotFoundResponse({
    description: 'No existe o es una cuenta del personal.',
  })
  detalle(
    @Param('codigoPublico', codigoPublico) codigo: string,
  ): Promise<ClienteDetalleDto> {
    return this.clientes.detalle(codigo);
  }

  @Post(':codigoPublico/desactivar')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Desactivar una cuenta de cliente o profesional (E13-H4)',
    description:
      'Cierra todas sus sesiones y le quita el acceso de inmediato. Pedidos, carrito, verificación y suscripciones no cambian. Desactivar una cuenta ya desactivada no hace nada.',
  })
  @ApiNoContentResponse({ description: 'Cuenta desactivada.' })
  @ApiBadRequestResponse({ description: 'El código no es válido.' })
  @ApiNotFoundResponse({
    description: 'No existe o es una cuenta del personal.',
  })
  desactivar(
    @Param('codigoPublico', codigoPublico) codigo: string,
    @UsuarioActual() administrador: UsuarioAutenticado,
  ): Promise<void> {
    return this.clientes.desactivar(codigo, administrador);
  }

  @Post(':codigoPublico/reactivar')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Reactivar una cuenta de cliente o profesional (E13-H4)',
    description:
      'Vuelve a iniciar sesión con su contraseña de siempre. Reactivar una cuenta activa no hace nada.',
  })
  @ApiNoContentResponse({ description: 'Cuenta reactivada.' })
  @ApiBadRequestResponse({ description: 'El código no es válido.' })
  @ApiNotFoundResponse({
    description: 'No existe o es una cuenta del personal.',
  })
  reactivar(
    @Param('codigoPublico', codigoPublico) codigo: string,
    @UsuarioActual() administrador: UsuarioAutenticado,
  ): Promise<void> {
    return this.clientes.reactivar(codigo, administrador);
  }
}
