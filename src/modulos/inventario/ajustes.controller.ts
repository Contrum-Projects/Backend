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
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
import { AjustesService } from './ajustes.service.js';
import { CrearAjusteDto } from './dto/crear-ajuste.dto.js';

@ApiTags('inventario')
@ApiBearerAuth()
@Controller('inventario/ajustes')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.INVENTARIO_REGISTRAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de registrar inventario.',
})
export class AjustesController {
  constructor(private readonly ajustes: AjustesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar un ajuste de stock (E11-H4)',
    description:
      'Corrige la diferencia entre el conteo físico y el stock registrado de un formato en una ubicación. La cantidad lleva signo: positiva suma y negativa descuenta. Deja un movimiento ajuste_positivo o ajuste_negativo con el motivo, en una transacción. El stock nunca queda bajo cero.',
  })
  @ApiCreatedResponse({ description: 'Ajuste registrado.' })
  @ApiBadRequestResponse({
    description:
      'Faltan datos o son inválidos (cantidad 0 o sin motivo), el formato o la ubicación no existe, o el ajuste negativo supera el stock de la ubicación.',
  })
  registrar(
    @Body() dto: CrearAjusteDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.ajustes.registrar(dto, usuario.codigoPublico);
  }
}
