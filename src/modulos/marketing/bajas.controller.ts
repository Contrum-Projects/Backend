import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAutenticacionGuard } from '../../autenticacion/jwt-autenticacion.guard.js';
import {
  PermisosGuard,
  RequierePermiso,
} from '../../autenticacion/permisos.guard.js';
import { PERMISOS } from '../../common/dominio/permisos.js';
import { type BajaDireccion, BajasService } from './bajas.service.js';
import { BajaRespuestaDto } from './dto/baja-respuesta.dto.js';
import { DarDeBajaDto } from './dto/dar-de-baja.dto.js';

/**
 * Baja de la publicidad desde el panel (E12-H2). La persona lo pide escribiendo al correo de
 * contacto y el administrador la registra aquí (decisión del equipo del 11 de noviembre de 2026).
 */
@ApiTags('marketing')
@ApiBearerAuth()
@Controller('marketing/bajas')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.CAMPANAS_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar campañas.',
})
export class BajasController {
  constructor(private readonly bajas: BajasService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dar de baja una dirección de la publicidad (E12-H2)',
    description:
      'Deja sin publicidad la cuenta y la suscripción sin cuenta con ese correo. Responde lo mismo si ya estaba de baja.',
  })
  @ApiOkResponse({
    type: BajaRespuestaDto,
    description: 'La dirección ya no recibe publicidad.',
  })
  @ApiBadRequestResponse({ description: 'Falta el correo o no es válido.' })
  @ApiNotFoundResponse({
    description: 'No hay cuenta ni suscripción con ese correo.',
  })
  darDeBaja(@Body() dto: DarDeBajaDto): Promise<BajaDireccion> {
    return this.bajas.darDeBaja(dto.email);
  }
}
