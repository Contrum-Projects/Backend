import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import { CompradorGuard } from '../../autenticacion/comprador.guard.js';
import {
  JwtAutenticacionGuard,
  UsuarioActual,
} from '../../autenticacion/jwt-autenticacion.guard.js';
import { TIPOS_ANTECEDENTE } from '../../common/dominio/valores.js';
import { LimitePorCuentaGuard } from '../../limites/limite-por-cuenta.guard.js';
import { LIMITES } from '../../limites/limites.js';
import { AdjuntarDocumentosDto } from './dto/adjuntar-documentos.dto.js';
import {
  type ArchivoAntecedente,
  DocumentosVerificacionService,
} from './documentos-verificacion.service.js';
import {
  SolicitudVerificacionService,
  type SolicitudVerificacionCuenta,
} from './solicitud-verificacion.service.js';
import {
  CAMPO_ANTECEDENTES,
  SubidaAntecedentesInterceptor,
} from './subida-antecedentes.interceptor.js';

/** Solicitud de verificación como profesional de la cuenta con la sesión iniciada (E10-H1). */
@ApiTags('verificacion')
@ApiBearerAuth()
@Controller('verificaciones')
@UseGuards(JwtAutenticacionGuard, CompradorGuard)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
@ApiForbiddenResponse({
  description: 'Cuenta del personal de tienda.',
})
export class SolicitudVerificacionController {
  constructor(
    private readonly solicitudes: SolicitudVerificacionService,
    private readonly documentos: DocumentosVerificacionService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(LimitePorCuentaGuard)
  @Throttle({ default: LIMITES.SOLICITAR_VERIFICACION })
  @ApiOperation({
    summary: 'Solicitar mi verificación como profesional (E10-H1)',
    description:
      'Sin cuerpo. Consulta en el SII el inicio de actividades del RUT de la cuenta, que debe estar registrado. Con el giro 960200 (Peluquería y otros tratamientos de belleza) vigente, la solicitud queda `aprobada`, la cuenta pasa a profesional y se le envía el correo de aviso (E10-H4): renovando la sesión (`POST /api/cuentas/sesion/renovar`) recibe el token con el rol nuevo y ve el precio mayorista. En cualquier otro caso, o si la consulta no está disponible, queda `pendiente` y `requiereDocumentos` es `true`: hay que adjuntar documentos para la revisión del personal. Nunca se rechaza sola. Si antes la rechazaron, se puede enviar una nueva y se consulta de nuevo.',
  })
  @ApiCreatedResponse({
    description:
      'Solicitud registrada: `aprobada`, o `pendiente` con `requiereDocumentos` en `true`.',
  })
  @ApiConflictResponse({
    description:
      'La cuenta no tiene RUT, ya es profesional o ya tiene una solicitud pendiente, en revisión manual o aprobada.',
  })
  @ApiTooManyRequestsResponse({
    description: 'Más de 5 solicitudes por hora de la misma cuenta.',
  })
  solicitar(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<SolicitudVerificacionCuenta> {
    return this.solicitudes.solicitar(usuario.codigoPublico);
  }

  @Post('yo/documentos')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(LimitePorCuentaGuard)
  @Throttle({ default: LIMITES.ADJUNTAR_DOCUMENTOS })
  @UseInterceptors(SubidaAntecedentesInterceptor)
  @ApiOperation({
    summary: 'Adjuntar los documentos de mi solicitud de verificación (E10-H2)',
    description:
      'Para quien no pasó la verificación automática: la solicitud está `pendiente` y `requiereDocumentos` es `true`. Recibe de 1 a 5 documentos en el campo `archivos` (PDF, JPG o PNG, hasta 4 MB cada uno, reconocidos por su contenido) y, en el campo `tipos`, el tipo de cada uno en el mismo orden (`titulo`, `certificado` u `otro`; un certificado de curso vale como `certificado`). La solicitud pasa a `revision_manual`, a la espera del personal. Los archivos se guardan privados y no se entregan por esta API.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [CAMPO_ANTECEDENTES, 'tipos'],
      properties: {
        [CAMPO_ANTECEDENTES]: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
        tipos: {
          type: 'array',
          items: { type: 'string', enum: Object.values(TIPOS_ANTECEDENTE) },
        },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'Documentos guardados: la solicitud queda en `revision_manual`.',
  })
  @ApiBadRequestResponse({
    description:
      'Sin documentos, más de 5, un archivo que no es PDF, JPG ni PNG, o los tipos no coinciden con los archivos.',
  })
  @ApiNotFoundResponse({ description: 'La cuenta nunca envió una solicitud.' })
  @ApiConflictResponse({
    description:
      'La solicitud ya fue aprobada, ya tiene documentos en revisión o fue rechazada (hay que enviar una nueva).',
  })
  @ApiPayloadTooLargeResponse({ description: 'Un documento supera los 4 MB.' })
  @ApiTooManyRequestsResponse({
    description: 'Más de 5 envíos de documentos por hora de la misma cuenta.',
  })
  @ApiServiceUnavailableResponse({
    description: 'El almacén de archivos no está configurado o no responde.',
  })
  adjuntarDocumentos(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: AdjuntarDocumentosDto,
    @UploadedFiles() archivos: ArchivoAntecedente[] | undefined,
  ): Promise<SolicitudVerificacionCuenta> {
    return this.documentos.adjuntar(usuario.codigoPublico, dto, archivos);
  }

  @Get('yo')
  @ApiOperation({
    summary: 'Ver el estado de mi solicitud de verificación (E10-H1)',
    description:
      'La solicitud más reciente de la cuenta: su estado (`pendiente`, `revision_manual`, `aprobada` o `rechazada`), las fechas, el motivo si fue rechazada, si debe adjuntar documentos y el nombre y tipo de los que ya adjuntó. Nunca incluye lo que respondió el SII, el puntaje ni quién la resolvió.',
  })
  @ApiOkResponse({ description: 'La solicitud más reciente.' })
  @ApiNotFoundResponse({
    description: 'La cuenta nunca envió una solicitud.',
  })
  verMiSolicitud(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<SolicitudVerificacionCuenta> {
    return this.solicitudes.verMiSolicitud(usuario.codigoPublico);
  }
}
