import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
import { PeriodoReporteDto } from './dto/periodo-reporte.dto.js';
import { ReportePeriodoCampanasDto } from './dto/reporte-campanas.dto.js';
import {
  type ReportePeriodoCampanas,
  type ResultadoCampana,
  ReporteCampanasService,
} from './reporte-campanas.service.js';

const ID_CAMPANA = new IdRutaPipe('La campaña no existe.');

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
export class ReporteCampanasController {
  constructor(private readonly reporte: ReporteCampanasService) {}

  @Get('campanas')
  @ApiOperation({
    summary: 'Resultados de las campañas de un período (E14-H3, SCRUM-150)',
    description:
      'Las campañas enviadas entre `desde` y `hasta` (ambos incluidos, hora de Chile) y una fila por mes con el saludo de cumpleaños, las más recientes primero. Los porcentajes son sobre los correos enviados.',
  })
  @ApiOkResponse({
    description: 'Resultados del período.',
    type: ReportePeriodoCampanasDto,
  })
  @ApiBadRequestResponse({
    description:
      'Fechas inválidas, `hasta` anterior a `desde` o un período de más de 366 días.',
  })
  periodo(
    @Query() periodo: PeriodoReporteDto,
  ): Promise<ReportePeriodoCampanas> {
    return this.reporte.periodo(periodo.desde, periodo.hasta);
  }

  @Get('campanas/:id')
  @ApiOperation({
    summary: 'Resultado de una campaña (E14-H3)',
    description:
      'Correos de la campaña: enviados, abiertos, con clic, rebotados, cancelados y fallidos, más los pendientes y el total. Sirve para las campañas de envío único y para el saludo de cumpleaños.',
  })
  @ApiOkResponse({
    description:
      '`id`, `tipo`, `asunto`, `fechaEnvio` y `envios` con `total`, `pendientes`, `enviados`, `abiertos`, `clics`, `rebotados`, `cancelados` y `fallidos`.',
  })
  @ApiNotFoundResponse({ description: 'La campaña no existe.' })
  @ApiConflictResponse({
    description: 'La campaña aún no se envía: no tiene resultados.',
  })
  resultado(@Param('id', ID_CAMPANA) id: number): Promise<ResultadoCampana> {
    return this.reporte.resultado(id);
  }
}
