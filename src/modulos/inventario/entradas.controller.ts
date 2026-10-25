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
  ApiConflictResponse,
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
import { CrearEntradaDto } from './dto/crear-entrada.dto.js';
import { EntradasService } from './entradas.service.js';

@ApiTags('inventario')
@ApiBearerAuth()
@Controller('inventario/entradas')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.INVENTARIO_REGISTRAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de registrar inventario.',
})
export class EntradasController {
  constructor(private readonly entradas: EntradasService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar una entrada de inventario (E11-H2)',
    description:
      'Recibe el proveedor, la fecha de recepción, la factura o guía de despacho del proveedor, la ubicación de destino y, por cada formato (una sola vez), la cantidad y el costo unitario neto. Suma lo recibido al stock de la ubicación y deja un movimiento de entrada por formato ligado a la entrada, todo en una transacción.',
  })
  @ApiCreatedResponse({ description: 'Entrada registrada.' })
  @ApiBadRequestResponse({
    description:
      'Faltan datos o son inválidos, un formato está repetido, la fecha es futura, o el proveedor, la ubicación o algún formato no existe o está desactivado.',
  })
  @ApiConflictResponse({
    description: 'Ya hay una entrada con ese documento del proveedor.',
  })
  registrar(
    @Body() dto: CrearEntradaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.entradas.registrar(dto, usuario.codigoPublico);
  }
}
