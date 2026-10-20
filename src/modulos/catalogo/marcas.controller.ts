import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAutenticacionGuard } from '../../autenticacion/jwt-autenticacion.guard.js';
import {
  PermisosGuard,
  RequierePermiso,
} from '../../autenticacion/permisos.guard.js';
import { PERMISOS } from '../../common/dominio/permisos.js';
import { CrearMarcaDto } from './dto/crear-marca.dto.js';
import { MarcasService } from './marcas.service.js';

@ApiTags('catalogo')
@ApiBearerAuth()
@Controller('catalogo/marcas')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.CATALOGO_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar el catálogo.',
})
export class MarcasController {
  constructor(private readonly marcas: MarcasService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear una marca (E3-H4)',
    description:
      'Guarda la marca y queda disponible en la lista de marcas al crear productos.',
  })
  @ApiCreatedResponse({ description: 'Marca creada.' })
  @ApiBadRequestResponse({ description: 'Datos inválidos.' })
  @ApiConflictResponse({ description: 'Ya existe una marca con ese nombre.' })
  crear(@Body() dto: CrearMarcaDto) {
    return this.marcas.crear(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar marcas',
    description: 'Por defecto solo las activas, ordenadas por nombre.',
  })
  @ApiQuery({
    name: 'incluirInactivas',
    required: false,
    type: Boolean,
    description: 'Con `true` incluye también las marcas desactivadas.',
  })
  @ApiOkResponse({ description: 'Lista de marcas.' })
  listar(@Query('incluirInactivas') incluirInactivas?: string) {
    return this.marcas.listar(incluirInactivas === 'true');
  }
}
