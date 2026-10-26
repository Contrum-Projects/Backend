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
import { CrearTransferenciaDto } from './dto/crear-transferencia.dto.js';
import { TransferenciasService } from './transferencias.service.js';

@ApiTags('inventario')
@ApiBearerAuth()
@Controller('inventario/transferencias')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.INVENTARIO_REGISTRAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de registrar inventario.',
})
export class TransferenciasController {
  constructor(private readonly transferencias: TransferenciasService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Transferir stock entre ubicaciones (E11-H4)',
    description:
      'Mueve unidades de un formato de una ubicación de origen a otra de destino (activa, de bodega activa), de la misma bodega o de otra. Resta en el origen, suma en el destino y deja un movimiento transferencia con ambas ubicaciones, en una transacción.',
  })
  @ApiCreatedResponse({ description: 'Transferencia registrada.' })
  @ApiBadRequestResponse({
    description:
      'Faltan datos o son inválidos, el origen y el destino son la misma ubicación, el formato o una ubicación no existe, el destino está desactivado, o la cantidad supera el stock del origen.',
  })
  registrar(
    @Body() dto: CrearTransferenciaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.transferencias.registrar(dto, usuario.codigoPublico);
  }
}
