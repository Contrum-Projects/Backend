import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAutenticacionGuard } from '../../autenticacion/jwt-autenticacion.guard.js';
import {
  PermisosGuard,
  RequierePermiso,
} from '../../autenticacion/permisos.guard.js';
import { PERMISOS } from '../../common/dominio/permisos.js';
import { Paginacion } from '../../common/validacion/paginacion.js';
import {
  ConsultaVerificacionService,
  type DetalleVerificacion,
  type EnlaceDocumento,
  type ListadoSolicitudesEnRevision,
} from './consulta-verificacion.service.js';

const codigoPublico = new ParseUUIDPipe();

/**
 * Panel: consulta de las solicitudes de verificación en revisión manual (E10-H7). Solo el personal
 * con `verificacion.gestionar`. Resolverlas es de `RevisionVerificacionController` (E10-H3). Va
 * después de `SolicitudVerificacionController` en el módulo: `GET /verificaciones/yo` debe
 * resolverse antes que `GET /verificaciones/:codigoPublico`.
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
export class ConsultaVerificacionController {
  constructor(private readonly consulta: ConsultaVerificacionService) {}

  @Get('revision-manual')
  @ApiOperation({
    summary: 'Listar las solicitudes en revisión manual (E10-H7)',
    description:
      'Las solicitudes que esperan al personal, de la más antigua a la más reciente, con el nombre y el RUT de quien solicitó, la fecha de la solicitud y el motivo de la revisión (`sin_inicio_actividades`, `otro_giro` o `no_disponible`). Paginado con `pagina` y `limite`. `codigoPublicoCuenta` abre el detalle y sirve para aprobar o rechazar.',
  })
  @ApiOkResponse({
    description: 'Página de solicitudes con el total; vacía si no hay.',
  })
  @ApiBadRequestResponse({ description: 'Paginación inválida.' })
  listar(
    @Query() paginacion: Paginacion,
  ): Promise<ListadoSolicitudesEnRevision> {
    return this.consulta.listar(paginacion);
  }

  @Get(':codigoPublico')
  @ApiOperation({
    summary: 'Ver el detalle de una solicitud de verificación (E10-H7)',
    description:
      'Los datos de la cuenta, su solicitud más reciente (estado, motivo de la revisión, resultado de la consulta al SII con fecha y giros, o `no_disponible` si falló) con sus documentos, y las solicitudes anteriores con su resolución. Un documento ya eliminado trae `fechaEliminacion`.',
  })
  @ApiParam({
    name: 'codigoPublico',
    description: 'Código público (UUID) de la cuenta que solicitó.',
  })
  @ApiOkResponse({ description: 'Detalle de la solicitud.' })
  @ApiBadRequestResponse({
    description: 'El código de la cuenta no es válido.',
  })
  @ApiNotFoundResponse({
    description: 'La cuenta no existe o nunca envió una solicitud.',
  })
  detalle(
    @Param('codigoPublico', codigoPublico) codigo: string,
  ): Promise<DetalleVerificacion> {
    return this.consulta.detalle(codigo);
  }

  @Get(':codigoPublico/documentos/:numero')
  @ApiOperation({
    summary: 'Pedir el enlace temporal a un documento (E10-H7)',
    description:
      'Un enlace firmado para ver o descargar el documento `numero` de la solicitud más reciente de la cuenta. Vence en 60 segundos: pasado ese plazo se pide otro, así que se pide al abrirlo y no se guarda. Los archivos nunca son públicos.',
  })
  @ApiParam({
    name: 'codigoPublico',
    description: 'Código público (UUID) de la cuenta que solicitó.',
  })
  @ApiParam({
    name: 'numero',
    description: 'Posición del documento en la solicitud, desde 1.',
  })
  @ApiOkResponse({ description: 'Enlace temporal y hasta cuándo sirve.' })
  @ApiBadRequestResponse({
    description: 'El código de la cuenta o el número no son válidos.',
  })
  @ApiNotFoundResponse({
    description:
      'La cuenta no tiene solicitudes o la solicitud no tiene ese documento.',
  })
  @ApiGoneResponse({
    description: 'El archivo ya se eliminó; el mensaje indica cuándo.',
  })
  enlaceDocumento(
    @Param('codigoPublico', codigoPublico) codigo: string,
    @Param('numero', new ParseIntPipe()) numero: number,
  ): Promise<EnlaceDocumento> {
    return this.consulta.enlaceDocumento(codigo, numero);
  }
}
