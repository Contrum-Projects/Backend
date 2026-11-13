import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { type BodegaPanel, BodegasService } from './bodegas.service.js';
import {
  ActualizarBodegaDto,
  ActualizarUbicacionDto,
  BodegaPanelDto,
  CrearBodegaDto,
  CrearUbicacionDto,
} from './dto/bodega.dto.js';

const ID_BODEGA = new IdRutaPipe('La bodega no existe.');
const ID_UBICACION = new IdRutaPipe('La ubicación no existe.');

/**
 * Bodegas y ubicaciones del panel (SCRUM-151). Solo con `bodegas.gestionar` (administrador); el
 * bodeguero sigue viendo las ubicaciones activas en `GET /inventario/ubicaciones`.
 */
@ApiTags('inventario')
@ApiBearerAuth()
@Controller('inventario/bodegas')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.BODEGAS_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar bodegas.',
})
export class BodegasController {
  constructor(private readonly bodegas: BodegasService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar las bodegas con sus ubicaciones (SCRUM-151)',
    description:
      'Todas, también las desactivadas, por nombre; cada una con sus ubicaciones por código y las unidades que guarda.',
  })
  @ApiOkResponse({ type: [BodegaPanelDto] })
  listar(): Promise<BodegaPanel[]> {
    return this.bodegas.listar();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear una bodega (SCRUM-151)' })
  @ApiCreatedResponse({ type: BodegaPanelDto })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o comuna que no existe.',
  })
  crear(@Body() dto: CrearBodegaDto): Promise<BodegaPanel> {
    return this.bodegas.crear(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Editar o desactivar una bodega (SCRUM-151)',
    description:
      'Con stock en alguna de sus ubicaciones no se desactiva (409).',
  })
  @ApiOkResponse({ type: BodegaPanelDto })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o comuna que no existe.',
  })
  @ApiNotFoundResponse({ description: 'La bodega no existe.' })
  @ApiConflictResponse({ description: 'Tiene stock y se pidió desactivarla.' })
  actualizar(
    @Param('id', ID_BODEGA) id: number,
    @Body() dto: ActualizarBodegaDto,
  ): Promise<BodegaPanel> {
    return this.bodegas.actualizar(id, dto);
  }

  @Post(':id/ubicaciones')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Agregar una ubicación a la bodega (SCRUM-151)',
    description: 'Devuelve la bodega con sus ubicaciones.',
  })
  @ApiCreatedResponse({ type: BodegaPanelDto })
  @ApiNotFoundResponse({ description: 'La bodega no existe.' })
  @ApiConflictResponse({ description: 'La bodega ya tiene ese código.' })
  crearUbicacion(
    @Param('id', ID_BODEGA) id: number,
    @Body() dto: CrearUbicacionDto,
  ): Promise<BodegaPanel> {
    return this.bodegas.crearUbicacion(id, dto);
  }

  @Patch(':id/ubicaciones/:ubicacionId')
  @ApiOperation({
    summary: 'Editar o desactivar una ubicación (SCRUM-151)',
    description:
      'Con stock no se desactiva (409). Devuelve la bodega con sus ubicaciones.',
  })
  @ApiOkResponse({ type: BodegaPanelDto })
  @ApiNotFoundResponse({ description: 'La ubicación no es de esa bodega.' })
  @ApiConflictResponse({
    description:
      'Código repetido en la bodega, o tiene stock y se pidió desactivarla.',
  })
  actualizarUbicacion(
    @Param('id', ID_BODEGA) id: number,
    @Param('ubicacionId', ID_UBICACION) ubicacionId: number,
    @Body() dto: ActualizarUbicacionDto,
  ): Promise<BodegaPanel> {
    return this.bodegas.actualizarUbicacion(id, ubicacionId, dto);
  }
}
