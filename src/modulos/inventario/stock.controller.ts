import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
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
import { JwtAutenticacionGuard } from '../../autenticacion/jwt-autenticacion.guard.js';
import {
  PermisosGuard,
  RequierePermiso,
} from '../../autenticacion/permisos.guard.js';
import { PERMISOS } from '../../common/dominio/permisos.js';
import { IdRutaPipe } from '../../common/validacion/id-ruta.pipe.js';
import { ListarStockDto } from './dto/listar-stock.dto.js';
import { ListadoStockDto } from './dto/stock-listado.dto.js';
import { ListadoStockService } from './listado-stock.service.js';
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
    private readonly listado: ListadoStockService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar el stock por formato (E11-H5)',
    description:
      'Un formato por fila (también los desactivados y los que nunca se recibieron, con stock 0), por producto y formato. Con `bodegaId`, solo los formatos con unidades en esa bodega, y sus ubicaciones y stock son los de ella. `bajoMinimo` sigue la regla del aviso (E11-H6): el stock total en todas las ubicaciones bajo un mínimo mayor que 0; `stockMinimo: 0` es «sin mínimo». Lleva el costo unitario neto y el proveedor de la entrada más reciente, o `null` si nunca se recibió.',
  })
  @ApiOkResponse({ description: 'Stock por formato.', type: ListadoStockDto })
  @ApiBadRequestResponse({
    description: 'Bodega, búsqueda o paginación inválidas.',
  })
  listar(@Query() filtros: ListarStockDto) {
    return this.listado.listar(filtros);
  }

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
