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
import { ConsultaRegistroErroresService } from './consulta-registro-errores.service.js';
import { ListarRegistroErroresDto } from './dto/listar-registro-errores.dto.js';
import { ListadoRegistroErroresDto } from './dto/registro-error-respuesta.dto.js';

/**
 * Panel: registro de errores (SCRUM-168). Solo el administrador (`registro_errores.ver`): trae
 * trazas y la cuenta de quien tuvo el error. Los guards van en la clase para que una ruta nueva
 * quede protegida aunque se olvide decorarla.
 */
@ApiTags('registros')
@ApiBearerAuth()
@Controller('registros/errores')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.REGISTRO_ERRORES_VER)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
@ApiForbiddenResponse({ description: 'Solo el administrador.' })
export class RegistroErroresController {
  constructor(private readonly consulta: ConsultaRegistroErroresService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar el registro de errores (SCRUM-168)',
    description:
      'Paginado, más recientes primero. Busca por el comienzo del código de seguimiento o por texto en el componente o el mensaje, y filtra por origen y por días en hora de Chile. `conteos` son los números de cada origen con los demás filtros aplicados.',
  })
  @ApiOkResponse({ type: ListadoRegistroErroresDto })
  @ApiBadRequestResponse({ description: 'Filtros inválidos.' })
  listar(
    @Query() filtros: ListarRegistroErroresDto,
  ): Promise<ListadoRegistroErroresDto> {
    return this.consulta.listar(filtros);
  }
}
