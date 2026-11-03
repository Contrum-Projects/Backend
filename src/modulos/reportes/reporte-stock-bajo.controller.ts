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
import {
  type FormatoBajoMinimo,
  StockBajoService,
} from '../inventario/stock-bajo.service.js';

/** Reportes del panel: solo el administrador, con `reportes.ver` (E14). */
@ApiTags('reportes')
@ApiBearerAuth()
@Controller('reportes')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.REPORTES_VER)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de ver los reportes.',
})
export class ReporteStockBajoController {
  constructor(private readonly stockBajo: StockBajoService) {}

  @Get('stock-bajo-minimo')
  @ApiOperation({
    summary: 'Formatos con stock bajo el mínimo (E14-H4)',
    description:
      'Los formatos con stock mínimo definido cuyo stock total (todas las ubicaciones) está bajo él, con el stock actual, el mínimo y lo que falta, del que más falta al que menos. Es el mismo cálculo del aviso del panel de bodega (E11-H6). Se calcula al consultar; si ningún formato está bajo su mínimo, devuelve una lista vacía.',
  })
  @ApiOkResponse({
    description:
      'Formatos bajo su stock mínimo (`formatoId`, `sku`, `producto`, `nombreFormato`, `activo`, `stockTotal`, `stockMinimo`, `faltante`); lista vacía si no hay.',
  })
  stockBajoMinimo(): Promise<FormatoBajoMinimo[]> {
    return this.stockBajo.listarBajoMinimo();
  }
}
