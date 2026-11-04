import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
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
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import {
  JwtAutenticacionGuard,
  UsuarioActual,
} from '../../autenticacion/jwt-autenticacion.guard.js';
import { ProfesionalGuard } from '../../autenticacion/profesional.guard.js';
import { GuardarPerfilProfesionalDto } from './dto/guardar-perfil-profesional.dto.js';
import {
  type PerfilProfesionalCuenta,
  PerfilProfesionalService,
} from './perfil-profesional.service.js';

/** Perfil profesional del peluquero con la verificación aprobada (E10-H5, RF-10.11). */
@ApiTags('verificacion')
@ApiBearerAuth()
@Controller('perfil-profesional/yo')
@UseGuards(JwtAutenticacionGuard, ProfesionalGuard)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
@ApiForbiddenResponse({
  description:
    'La cuenta no tiene la verificación aprobada (no es profesional). Un cliente recién aprobado debe renovar la sesión.',
})
export class PerfilProfesionalController {
  constructor(private readonly perfiles: PerfilProfesionalService) {}

  @Get()
  @ApiOperation({ summary: 'Ver mi perfil profesional (E10-H5)' })
  @ApiOkResponse({ description: 'Perfil profesional de la cuenta.' })
  @ApiNotFoundResponse({ description: 'Aún no completa su perfil.' })
  obtener(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PerfilProfesionalCuenta> {
    return this.perfiles.obtener(usuario.codigoPublico);
  }

  @Put()
  @ApiOperation({
    summary: 'Guardar mi perfil profesional (E10-H5)',
    description:
      'Crea el perfil o lo reemplaza entero. Obligatorios: años de experiencia (0 a 40), una modalidad de trabajo y al menos una especialidad. El lugar de trabajo y la red social son opcionales; si no vienen, quedan sin valor.',
  })
  @ApiOkResponse({ description: 'Perfil guardado.' })
  @ApiBadRequestResponse({
    description:
      'Falta algún dato obligatorio o hay datos inválidos. El mensaje indica cuáles.',
  })
  guardar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: GuardarPerfilProfesionalDto,
  ): Promise<PerfilProfesionalCuenta> {
    return this.perfiles.guardar(usuario.codigoPublico, dto);
  }
}
