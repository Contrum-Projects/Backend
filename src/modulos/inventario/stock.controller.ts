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
import { StockBajoService } from './stock-bajo.service.js';

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
  constructor(
    private readonly stock: StockService,
    private readonly stockBajo: StockBajoService,
  ) {}

  // Decisión del 28 de octubre de 2026: solo bodega y administración, que son quienes reciben
  // el correo; el vendedor consulta stock pero no ve este aviso
  @Get('bajo-minimo')
  @RequierePermiso(PERMISOS.INVENTARIO_REGISTRAR)
  @ApiOperation({
    summary: 'Formatos con stock bajo el mínimo (E11-H6)',
    description:
      'Aviso del panel: los formatos con stock mínimo definido cuyo stock total (todas las ubicaciones) está bajo él, del que más falta al que menos. Se calcula al consultar: un formato sale de la lista al reponerlo.',
  })
  @ApiOkResponse({ description: 'Formatos bajo su stock mínimo.' })
  bajoMinimo() {
    return this.stockBajo.listarBajoMinimo();
  }

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
