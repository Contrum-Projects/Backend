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
import { PeriodoReporteDto } from './dto/periodo-reporte.dto.js';
import {
  type ReporteIndicadores,
  ReporteIndicadoresService,
} from './reporte-indicadores.service.js';

/** Indicadores de los objetivos del proyecto: solo el administrador, con `reportes.ver` (E14-H1). */
@ApiTags('reportes')
@ApiBearerAuth()
@Controller('reportes')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.REPORTES_VER)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de ver los reportes.',
})
export class ReporteIndicadoresController {
  constructor(private readonly reporte: ReporteIndicadoresService) {}

  @Get('indicadores')
  @ApiOperation({
    summary: 'Indicadores de los objetivos del proyecto (E14-H1)',
    description:
      'Entre las dos fechas, ambas incluidas y en hora de Chile, cada objetivo con su porcentaje y su meta. **OE1** (meta 30 %): de las cuentas verificadas como profesionales en el período, cuántas compraron (pedido pagado) desde su aprobación. **OE2** (meta 70 %): de las solicitudes de verificación presentadas en el período, cuántas se resolvieron en 48 horas o menos; las que siguen sin resolver y aún están dentro de las 48 horas no cuentan. **OE3** (meta 80 %): de los productos creados en el período, cuántos tienen la descripción de la IA, aceptada o corregida. Sin datos, `porcentaje` es `null` y `sinDatos` es `true`.',
  })
  @ApiOkResponse({
    description:
      '`desde`, `hasta` e `indicadores`: por cada objetivo `codigo`, `nombre`, `meta`, `porcentaje` (con un decimal, o `null`), `cumplidos`, `total` y `sinDatos`.',
  })
  @ApiBadRequestResponse({
    description:
      'Fechas inválidas, la fecha hasta anterior a la desde o un período de más de 366 días.',
  })
  indicadores(
    @Query() periodo: PeriodoReporteDto,
  ): Promise<ReporteIndicadores> {
    return this.reporte.indicadores(periodo.desde, periodo.hasta);
  }
}
