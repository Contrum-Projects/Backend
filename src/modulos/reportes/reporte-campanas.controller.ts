import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
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
import {
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
