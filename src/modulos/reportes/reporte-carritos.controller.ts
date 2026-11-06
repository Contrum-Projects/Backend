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
import { ReporteCarritosDto } from './dto/reporte-carritos.dto.js';
import {
  type ReporteCarritos,
  ReporteCarritosService,
} from './reporte-carritos.service.js';

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
export class ReporteCarritosController {
  constructor(private readonly reporte: ReporteCarritosService) {}

  @Get('carritos-abandonados')
  @ApiOperation({
    summary: 'Carritos abandonados y recuperados por mes (E14-H3)',
    description:
      'Por cada mes entre los dos indicados, ambos incluidos y en hora de Chile: cuántos carritos se abandonaron (una serie de recordatorios cuenta una vez, en el mes de su primer recordatorio) y cuántos de ellos terminaron en una compra pagada de la misma cuenta dentro de 7 días desde el primer recordatorio y antes del abandono siguiente. Los meses sin abandonos salen en cero.',
  })
  @ApiOkResponse({
    description:
      '`desde`, `hasta`, `meses` (cada uno con `mes`, `abandonados` y `recuperados`) y `total`.',
  })
  @ApiBadRequestResponse({
    description:
      'Meses inválidos, el mes hasta anterior al desde o un período de más de 24 meses.',
  })
  carritosAbandonados(
    @Query() periodo: ReporteCarritosDto,
  ): Promise<ReporteCarritos> {
    return this.reporte.carritosPorMes(periodo.desde, periodo.hasta);
  }
}
