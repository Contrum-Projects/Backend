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
import { ReporteIndicadoresRespuestaDto } from './dto/indicadores-carritos-respuesta.dto.js';
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
      'Entre las dos fechas, ambas incluidas y en hora de Chile, cada objetivo con su porcentaje y su meta. El período anterior tiene los mismos días y termina justo antes de `desde`. **OE1 Facturación digital** (meta +20 %): cuánto crece el monto total de los pedidos pagados frente al período anterior; `cumplidos` es el monto del período y `total` el del anterior, en pesos. **OE2 Quiebres de stock** (meta −80 %): cuánto bajan los quiebres (un movimiento que deja en 0 el stock total de un formato que tenía stock) frente al período anterior; `cumplidos` son los del período y `total` los del anterior. **OE3 Alcance territorial** (meta 30 %): de los pedidos pagados del período (`total`), cuántos se despachan fuera de Talcahuano, Concepción, Hualpén, San Pedro de la Paz, Penco y Chiguayante (`cumplidos`); el retiro en tienda cuenta como local. En OE1 y OE2 el porcentaje puede ser negativo. Sin datos (sin ventas o sin quiebres en el período anterior, o sin pedidos), `porcentaje` es `null` y `sinDatos` es `true`.',
  })
  @ApiOkResponse({
    description:
      '`desde`, `hasta` e `indicadores`: por cada objetivo `codigo`, `nombre`, `meta`, `porcentaje` (con un decimal, o `null`), `cumplidos`, `total`, `sinDatos` y `estado` frente a la meta.',
    type: ReporteIndicadoresRespuestaDto,
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
