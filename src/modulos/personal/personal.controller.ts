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
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import {
  JwtAutenticacionGuard,
  UsuarioActual,
} from '../../autenticacion/jwt-autenticacion.guard.js';
import { Roles, RolesGuard } from '../../autenticacion/roles.guard.js';
import { ROLES } from '../../common/dominio/roles.js';
import { LIMITES } from '../../limites/limites.js';
import { AceptarInvitacionDto } from './dto/aceptar-invitacion.dto.js';
import { CrearPersonalDto } from './dto/crear-personal.dto.js';
import { type CuentaPersonal, PersonalService } from './personal.service.js';

const codigoPublico = new ParseUUIDPipe();

@ApiTags('personal')
@Controller('personal')
export class PersonalController {
  constructor(private readonly personal: PersonalService) {}

  @Get()
  @UseGuards(JwtAutenticacionGuard, RolesGuard)
  @Roles(ROLES.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar las cuentas del personal (E13-H1)' })
  @ApiOkResponse({ description: 'Cuentas activas y desactivadas.' })
  @ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
  @ApiForbiddenResponse({ description: 'Solo el administrador.' })
  listar(): Promise<CuentaPersonal[]> {
    return this.personal.listar();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAutenticacionGuard, RolesGuard)
  @Roles(ROLES.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Crear una cuenta del personal (E13-H1)',
    description:
      'Crea la cuenta con un único rol y envía la invitación para que la persona defina su contraseña.',
  })
  @ApiCreatedResponse({ description: 'Cuenta creada; invitación encolada.' })
  @ApiBadRequestResponse({ description: 'Datos inválidos o rol no permitido.' })
  @ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
  @ApiForbiddenResponse({ description: 'Solo el administrador.' })
  @ApiConflictResponse({ description: 'El correo ya está registrado.' })
  crear(
    @Body() dto: CrearPersonalDto,
    @UsuarioActual() administrador: UsuarioAutenticado,
  ): Promise<CuentaPersonal> {
    return this.personal.crear(dto, administrador);
  }

  @Post('invitacion/aceptar')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: LIMITES.ACEPTAR_INVITACION })
  @ApiOperation({
    summary: 'Definir la contraseña con el enlace de la invitación (E13-H1)',
  })
  @ApiOkResponse({ description: 'Contraseña definida.' })
  @ApiBadRequestResponse({
    description:
      'Contraseña inválida o distinta, o enlace inválido, usado o vencido.',
  })
  @ApiTooManyRequestsResponse({
    description: 'Más de 5 peticiones por minuto desde la misma IP.',
  })
  aceptarInvitacion(@Body() dto: AceptarInvitacionDto) {
    return this.personal.aceptarInvitacion(dto);
  }

  @Post(':codigoPublico/invitacion')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAutenticacionGuard, RolesGuard)
  @Roles(ROLES.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reenviar la invitación (E13-H1)',
    description:
      'Solo a cuentas activas que aún no definen su contraseña; el enlace anterior deja de servir.',
  })
  @ApiNoContentResponse({ description: 'Invitación encolada.' })
  @ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
  @ApiForbiddenResponse({ description: 'Solo el administrador.' })
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
  @UseGuards(JwtAutenticacionGuard, RolesGuard)
  @Roles(ROLES.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Desactivar una cuenta del personal (E13-H1)',
    description:
      'Cierra todas sus sesiones y le quita el acceso de inmediato. Desactivar una cuenta ya desactivada no hace nada.',
  })
  @ApiNoContentResponse({ description: 'Cuenta desactivada.' })
  @ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
  @ApiForbiddenResponse({ description: 'Solo el administrador.' })
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
