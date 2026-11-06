import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
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
import {
  JwtAutenticacionGuard,
  UsuarioActual,
} from '../../autenticacion/jwt-autenticacion.guard.js';
import {
  PermisosGuard,
  RequierePermiso,
} from '../../autenticacion/permisos.guard.js';
import { PERMISOS } from '../../common/dominio/permisos.js';
import {
  type ConfiguracionCumpleanos,
  CumpleanosService,
} from './cumpleanos.service.js';
import { ConfigurarCumpleanosDto } from './dto/configurar-cumpleanos.dto.js';

/**
 * Saludo de cumpleaños del panel (E12-H5). Solo con `campanas.gestionar` (administrador): es
 * publicidad, como las campañas.
 */
@ApiTags('marketing')
@ApiBearerAuth()
@Controller('marketing/cumpleanos')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.CAMPANAS_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar campañas.',
})
export class CumpleanosController {
  constructor(private readonly cumpleanos: CumpleanosService) {}

  @Get()
  @ApiOperation({
    summary: 'Ver el saludo de cumpleaños (E12-H5)',
    description:
      'Asunto, saludo y oferta. Si nunca se configuró, devuelve el saludo por defecto, sin oferta, con `configurado: false`.',
  })
  @ApiOkResponse({ description: 'Saludo de cumpleaños.' })
  obtener(): Promise<ConfiguracionCumpleanos> {
    return this.cumpleanos.obtener();
  }

  @Put()
  @ApiOperation({
    summary: 'Configurar el saludo de cumpleaños y su oferta (E12-H5)',
    description:
      'Reemplaza el asunto, el saludo y la oferta. Los saludos que salgan desde ahora llevan la oferta si está activa.',
  })
  @ApiOkResponse({ description: 'Saludo guardado.' })
  @ApiBadRequestResponse({
    description: 'Datos inválidos, o oferta activa sin texto.',
  })
  configurar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: ConfigurarCumpleanosDto,
  ): Promise<ConfiguracionCumpleanos> {
    return this.cumpleanos.configurar(dto, usuario.codigoPublico);
  }
}
