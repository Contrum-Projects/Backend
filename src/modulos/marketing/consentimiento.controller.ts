import { Body, Controller, Put, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
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
  type ConsentimientoMarketing,
  ConsentimientoService,
} from './consentimiento.service.js';
import { ActualizarConsentimientoDto } from './dto/actualizar-consentimiento.dto.js';

/** Consentimiento de publicidad de la cuenta con la sesión iniciada (cliente y profesional). */
@ApiTags('marketing')
@ApiBearerAuth()
@Controller('cuentas/yo/consentimiento-marketing')
@UseGuards(JwtAutenticacionGuard, CompradorGuard)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
@ApiForbiddenResponse({ description: 'Cuenta del personal de tienda.' })
export class ConsentimientoController {
  constructor(private readonly consentimiento: ConsentimientoService) {}

  @Put()
  @ApiOperation({
    summary: 'Elegir si recibo ofertas por correo (E12-H2)',
    description:
      'Activarlo guarda la fecha del consentimiento; desactivarlo la conserva.',
  })
  @ApiOkResponse({ description: 'Preferencia guardada.' })
  @ApiBadRequestResponse({ description: 'Falta `acepta` o no es booleano.' })
  actualizar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: ActualizarConsentimientoDto,
  ): Promise<ConsentimientoMarketing> {
    return this.consentimiento.actualizar(usuario.codigoPublico, dto.acepta);
  }
}
