import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
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
import { UbicacionInventarioDto } from './dto/ubicacion-inventario.dto.js';
import { UbicacionesService } from './ubicaciones.service.js';

@ApiTags('inventario')
@ApiBearerAuth()
@Controller('inventario/ubicaciones')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.INVENTARIO_CONSULTAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de consultar inventario.',
})
export class UbicacionesController {
  constructor(private readonly ubicaciones: UbicacionesService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar las ubicaciones activas (E11)',
    description:
      'Ubicaciones activas de bodegas activas, ordenadas por bodega y código: el destino de una entrada, un ajuste o una transferencia, y el filtro por bodega del inventario.',
  })
  @ApiOkResponse({
    description: 'Ubicaciones activas.',
    type: [UbicacionInventarioDto],
  })
  listar() {
    return this.ubicaciones.listarActivas();
  }
}
