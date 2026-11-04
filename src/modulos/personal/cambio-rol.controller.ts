import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
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
import { type CambioRol, CambioRolService } from './cambio-rol.service.js';
import { CambiarRolDto } from './dto/cambiar-rol.dto.js';

const codigoPublico = new ParseUUIDPipe();

/**
 * Panel: bajar el rol de una cuenta del personal o de un profesional (E13-H3). Va en `cuentas`
 * porque el profesional no es parte del personal; los guards van en la clase.
 */
@ApiTags('personal')
@ApiBearerAuth()
@Controller('cuentas')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.PERSONAL_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
@ApiForbiddenResponse({ description: 'Solo el administrador.' })
export class CambioRolController {
  constructor(private readonly cambioRol: CambioRolService) {}

  @Patch(':codigoPublico/rol')
  @ApiOperation({
    summary: 'Bajar el rol de una cuenta (E13-H3)',
    description:
      'Un administrador pasa a vendedor o bodeguero; un profesional, a cliente (con motivo, que se le envía por correo). ' +
      'Rige de inmediato: cierra todas las sesiones de la cuenta. Los pedidos ya creados conservan sus montos.',
  })
  @ApiOkResponse({ description: 'Rol cambiado y registrado en el historial.' })
  @ApiBadRequestResponse({
    description: 'Rol no permitido o motivo faltante o inválido.',
  })
  @ApiNotFoundResponse({ description: 'No existe esa cuenta.' })
  @ApiConflictResponse({
    description:
      'Cuenta desactivada, cambio que no baja el rol o último administrador activo.',
  })
  cambiar(
    @Param('codigoPublico', codigoPublico) codigo: string,
    @Body() dto: CambiarRolDto,
    @UsuarioActual() administrador: UsuarioAutenticado,
  ): Promise<CambioRol> {
    return this.cambioRol.cambiar(codigo, dto, administrador);
  }
}
