import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
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
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import {
  JwtAutenticacionGuard,
  UsuarioActual,
} from '../../autenticacion/jwt-autenticacion.guard.js';
import {
  PermisosGuard,
  RequierePermiso,
} from '../../autenticacion/permisos.guard.js';
import { PERMISOS } from '../../common/dominio/permisos.js';
import { FijarPreciosDto } from './dto/fijar-precios.dto.js';
import { IdArticuloPipe } from './id-articulo.pipe.js';
import { PreciosService } from './precios.service.js';

@ApiTags('catalogo')
@ApiBearerAuth()
@Controller('catalogo/articulos/:id/precios')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.PRECIOS_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar los precios.',
})
@ApiNotFoundResponse({ description: 'El artículo no existe.' })
export class PreciosController {
  constructor(private readonly precios: PreciosService) {}

  @Get()
  @ApiOperation({
    summary: 'Ver los precios de un artículo y su historial (E3-H5)',
    description:
      'Precios netos vigentes, si el artículo es exclusivo para profesionales y el historial de cambios con su vigencia, quién los fijó y el motivo, del más reciente al más antiguo. El id del artículo es el del formato o del pack.',
  })
  @ApiOkResponse({ description: 'Precios del artículo.' })
  listar(@Param('id', IdArticuloPipe) articuloId: number) {
    return this.precios.listar(articuloId);
  }

  @Put()
  @ApiOperation({
    summary: 'Fijar el precio minorista y el mayorista de un artículo (E3-H5)',
    description:
      'Recibe uno o los dos precios netos (sin IVA) y el motivo; el precio que no llega no cambia. Cada precio que cambia cierra la vigencia del anterior y queda en el historial con quién lo fijó y el motivo; uno igual al vigente no se registra. Un artículo exclusivo para profesionales solo lleva precio mayorista. Devuelve los precios y el historial.',
  })
  @ApiOkResponse({ description: 'Precios aplicados.' })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, sin ningún precio o con precio minorista en un artículo exclusivo.',
  })
  fijar(
    @Param('id', IdArticuloPipe) articuloId: number,
    @Body() dto: FijarPreciosDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.precios.fijar(articuloId, dto, usuario.codigoPublico);
  }
}
