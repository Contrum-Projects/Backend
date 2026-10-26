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
import { CrearSalidaDto } from './dto/crear-salida.dto.js';
import { SalidasService } from './salidas.service.js';

@ApiTags('inventario')
@ApiBearerAuth()
@Controller('inventario/salidas')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.INVENTARIO_REGISTRAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de registrar inventario.',
})
export class SalidasController {
  constructor(private readonly salidas: SalidasService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar una salida que no es venta (E11-H3)',
    description:
      'Registra una merma por vencimiento, una merma por daño o un consumo en la peluquería de un formato en una ubicación. Descuenta la cantidad del stock de esa ubicación y deja un movimiento con el tipo de salida, en una transacción. El stock nunca queda bajo cero.',
  })
  @ApiCreatedResponse({ description: 'Salida registrada.' })
  @ApiBadRequestResponse({
    description:
      'Faltan datos o son inválidos, el formato o la ubicación no existe, o la cantidad supera el stock de la ubicación.',
  })
  registrar(
    @Body() dto: CrearSalidaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.salidas.registrar(dto, usuario.codigoPublico);
  }
}
