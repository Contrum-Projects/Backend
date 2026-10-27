import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
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
import { IdRutaPipe } from '../../common/validacion/id-ruta.pipe.js';
import { StockService } from './stock.service.js';

const ID_FORMATO = new IdRutaPipe('El formato no existe.');

@ApiTags('inventario')
@ApiBearerAuth()
@Controller('inventario/stock')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.INVENTARIO_CONSULTAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de consultar inventario.',
})
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('formatos/:id')
  @ApiOperation({
    summary: 'Consultar el stock de un formato por ubicación (E11-H5)',
    description:
      'Devuelve las unidades del formato en cada ubicación que tiene stock (también las desactivadas, marcadas como inactivas), el total y el proveedor y costo unitario neto de su entrada de recepción más reciente. Si el formato nunca se ha recibido, el total es 0 y la última entrada es nula.',
  })
  @ApiOkResponse({ description: 'Stock del formato.' })
  @ApiNotFoundResponse({ description: 'El formato no existe.' })
  consultar(@Param('id', ID_FORMATO) id: number) {
    return this.stock.consultar(id);
  }
}
