import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
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
import { LimitePorCuentaGuard } from '../../limites/limite-por-cuenta.guard.js';
import { LIMITES } from '../../limites/limites.js';
import {
  SolicitudVerificacionService,
  type SolicitudVerificacionCuenta,
} from './solicitud-verificacion.service.js';

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
  constructor(private readonly solicitudes: SolicitudVerificacionService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(LimitePorCuentaGuard)
  @Throttle({ default: LIMITES.SOLICITAR_VERIFICACION })
  @ApiOperation({
    summary: 'Solicitar mi verificación como profesional (E10-H1)',
    description:
      'Sin cuerpo. Consulta en el SII el inicio de actividades del RUT de la cuenta, que debe estar registrado. Con el giro 960200 (Peluquería y otros tratamientos de belleza) vigente, la solicitud queda `aprobada`. En cualquier otro caso, o si la consulta no está disponible, queda `pendiente` y `requiereDocumentos` es `true`: hay que adjuntar documentos para la revisión del personal. Nunca se rechaza sola. Si antes la rechazaron, se puede enviar una nueva y se consulta de nuevo.',
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

  @Get('yo')
  @ApiOperation({
    summary: 'Ver el estado de mi solicitud de verificación (E10-H1)',
    description:
      'La solicitud más reciente de la cuenta: su estado (`pendiente`, `revision_manual`, `aprobada` o `rechazada`), las fechas, el motivo si fue rechazada y si debe adjuntar documentos. Nunca incluye lo que respondió el SII, el puntaje ni quién la resolvió.',
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
