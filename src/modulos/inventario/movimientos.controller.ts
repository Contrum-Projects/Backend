import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { ListarMovimientosDto } from './dto/listar-movimientos.dto.js';
import { ListadoMovimientosDto } from './dto/movimiento-listado.dto.js';
import { ListadoMovimientosService } from './listado-movimientos.service.js';

@ApiTags('inventario')
@ApiBearerAuth()
@Controller('inventario/movimientos')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.INVENTARIO_CONSULTAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de consultar inventario.',
})
export class MovimientosController {
  constructor(private readonly movimientos: ListadoMovimientosService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar los movimientos de inventario (E11-H5)',
    description:
      'Del más reciente al más antiguo: entradas, ventas, mermas, consumo, ajustes, transferencias y reingresos, con su referencia y quién los registró (`null` en ventas y reingresos, que registra el sistema). Filtra por bodega (origen o destino), grupo, período en hora de Chile y búsqueda.',
  })
  @ApiOkResponse({
    description: 'Movimientos, paginados.',
    type: ListadoMovimientosDto,
  })
  @ApiBadRequestResponse({
    description: 'Filtros inválidos o `hasta` anterior a `desde`.',
  })
  listar(@Query() filtros: ListarMovimientosDto) {
    return this.movimientos.listar(filtros);
  }
}
