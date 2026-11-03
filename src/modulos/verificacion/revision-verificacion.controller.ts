import {
  Body,
  Controller,
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
  ApiForbiddenResponse,
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
import { RechazarSolicitudDto } from './dto/rechazar-solicitud.dto.js';
import {
  RevisionVerificacionService,
  type SolicitudResuelta,
} from './revision-verificacion.service.js';

const codigoPublico = new ParseUUIDPipe();

/**
 * Panel: revisión manual de las solicitudes de verificación (E10-H3). Solo el personal con
 * `verificacion.gestionar`. Los guards van en la clase para que una ruta nueva quede protegida
 * aunque se olvide decorarla. La cuenta se identifica por su `codigoPublico` (RNF-07): las rutas
 * actúan sobre su solicitud más reciente, la única que puede estar abierta.
 */
@ApiTags('verificacion')
@ApiBearerAuth()
@Controller('verificaciones')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.VERIFICACION_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar verificaciones.',
})
@ApiParam({
  name: 'codigoPublico',
  description: 'Código público (UUID) de la cuenta que solicitó.',
})
@ApiNotFoundResponse({
  description: 'La cuenta no existe o nunca envió una solicitud.',
})
@ApiConflictResponse({
  description:
    'La solicitud más reciente no está en revisión manual: aún no adjunta documentos, o ya fue aprobada o rechazada.',
})
export class RevisionVerificacionController {
  constructor(private readonly revision: RevisionVerificacionService) {}

  @Post(':codigoPublico/aprobar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Aprobar una solicitud en revisión manual (E10-H3)',
    description:
      'Sin cuerpo. Deja `aprobada` la solicitud en revisión manual de la cuenta y registra quién la resolvió y cuándo. En la misma operación la cuenta pasa a profesional y se le envía el correo de aviso (E10-H4); sus sesiones siguen abiertas y obtienen el precio mayorista al renovarse (`POST /api/cuentas/sesion/renovar`).',
  })
  @ApiOkResponse({ description: 'Solicitud aprobada.' })
  @ApiConflictResponse({
    description:
      'La solicitud más reciente no está en revisión manual, o la cuenta está desactivada o ya no es cliente.',
  })
  @ApiBadRequestResponse({
    description: 'El código de la cuenta no es válido.',
  })
  aprobar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('codigoPublico', codigoPublico) codigo: string,
  ): Promise<SolicitudResuelta> {
    return this.revision.aprobar(usuario.codigoPublico, codigo);
  }

  @Post(':codigoPublico/rechazar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rechazar con motivo una solicitud en revisión manual (E10-H3)',
    description:
      'Deja `rechazada` la solicitud en revisión manual de la cuenta, guarda el motivo (obligatorio, de 10 a 1000 caracteres) y registra quién la resolvió y cuándo. Quien solicitó ve el motivo y puede enviar una solicitud nueva.',
  })
  @ApiOkResponse({ description: 'Solicitud rechazada con su motivo.' })
  @ApiBadRequestResponse({
    description:
      'Falta el motivo, tiene menos de 10 o más de 1000 caracteres, o el código de la cuenta no es válido.',
  })
  rechazar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('codigoPublico', codigoPublico) codigo: string,
    @Body() dto: RechazarSolicitudDto,
  ): Promise<SolicitudResuelta> {
    return this.revision.rechazar(usuario.codigoPublico, codigo, dto);
  }
}
