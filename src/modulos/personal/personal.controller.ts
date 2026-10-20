import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
import {
  JwtAutenticacionGuard,
  UsuarioActual,
} from '../../autenticacion/jwt-autenticacion.guard.js';
import {
  PermisosGuard,
  RequierePermiso,
} from '../../autenticacion/permisos.guard.js';
import { PERMISOS } from '../../common/dominio/permisos.js';
import { CrearPersonalDto } from './dto/crear-personal.dto.js';
import { type CuentaPersonal, PersonalService } from './personal.service.js';

const codigoPublico = new ParseUUIDPipe();

/**
 * Panel: gestión de las cuentas del personal. Los guards van en la clase para que una ruta nueva
 * quede protegida aunque se olvide decorarla; la ruta pública de la invitación está en
 * `InvitacionPersonalController`.
 */
@ApiTags('personal')
@ApiBearerAuth()
@Controller('personal')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.PERSONAL_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
@ApiForbiddenResponse({ description: 'Solo el administrador.' })
export class PersonalController {
  constructor(private readonly personal: PersonalService) {}

  @Get()
  @ApiOperation({ summary: 'Listar las cuentas del personal (E13-H1)' })
  @ApiOkResponse({ description: 'Cuentas activas y desactivadas.' })
  listar(): Promise<CuentaPersonal[]> {
    return this.personal.listar();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear una cuenta del personal (E13-H1)',
    description:
      'Crea la cuenta con un único rol y envía la invitación para que la persona defina su contraseña.',
  })
  @ApiCreatedResponse({ description: 'Cuenta creada; invitación encolada.' })
  @ApiBadRequestResponse({ description: 'Datos inválidos o rol no permitido.' })
  @ApiConflictResponse({ description: 'El correo ya está registrado.' })
  crear(
    @Body() dto: CrearPersonalDto,
    @UsuarioActual() administrador: UsuarioAutenticado,
  ): Promise<CuentaPersonal> {
    return this.personal.crear(dto, administrador);
  }

  @Post(':codigoPublico/invitacion')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Reenviar la invitación (E13-H1)',
    description:
      'Solo a cuentas activas que aún no definen su contraseña; el enlace anterior deja de servir.',
  })
  @ApiNoContentResponse({ description: 'Invitación encolada.' })
  @ApiNotFoundResponse({ description: 'No existe esa cuenta del personal.' })
  @ApiConflictResponse({
    description: 'La cuenta está desactivada o ya definió su contraseña.',
  })
  reenviarInvitacion(
    @Param('codigoPublico', codigoPublico) codigo: string,
    @UsuarioActual() administrador: UsuarioAutenticado,
  ): Promise<void> {
    return this.personal.reenviarInvitacion(codigo, administrador);
  }

  @Post(':codigoPublico/desactivar')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Desactivar una cuenta del personal (E13-H1)',
    description:
      'Cierra todas sus sesiones y le quita el acceso de inmediato. Desactivar una cuenta ya desactivada no hace nada.',
  })
  @ApiNoContentResponse({ description: 'Cuenta desactivada.' })
  @ApiNotFoundResponse({ description: 'No existe esa cuenta del personal.' })
  @ApiConflictResponse({
    description: 'Es la propia cuenta.',
  })
  desactivar(
    @Param('codigoPublico', codigoPublico) codigo: string,
    @UsuarioActual() administrador: UsuarioAutenticado,
  ): Promise<void> {
    return this.personal.desactivar(codigo, administrador);
  }
}
