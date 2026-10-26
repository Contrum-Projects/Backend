import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { Paginacion } from '../../common/validacion/paginacion.js';
import { ActualizarPackDto } from './dto/actualizar-pack.dto.js';
import { CrearPackDto } from './dto/crear-pack.dto.js';
import { ID_PACK } from './ids-ruta.js';
import { PacksService } from './packs.service.js';

@ApiTags('catalogo')
@ApiBearerAuth()
@Controller('catalogo/packs')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.CATALOGO_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar el catálogo.',
})
export class PacksController {
  constructor(private readonly packs: PacksService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear un pack con sus formatos componentes (E3-H6)',
    description:
      'Guarda el pack activo con su SKU, nombre, descripción, canal de venta, vigencia opcional (días incluidos, hora de Chile) y sus formatos componentes con sus cantidades. Nace sin precios (los fija el administrador en `PUT /catalogo/articulos/:id/precios`) y sin stock propio: su disponibilidad sale de sus componentes. Solo admite formatos de producto como componentes.',
  })
  @ApiCreatedResponse({ description: 'Pack creado.' })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, vigencia al revés, otro pack como componente, un formato inexistente o desactivado, o un formato exclusivo en un pack general.',
  })
  @ApiConflictResponse({ description: 'El SKU ya pertenece a otro artículo.' })
  crear(@Body() dto: CrearPackDto) {
    return this.packs.crear(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar los packs (E3-H6)',
    description:
      'Packs ordenados por nombre y paginados, con sus componentes y si hoy están vigentes.',
  })
  @ApiOkResponse({ description: 'Página de packs con el total.' })
  @ApiBadRequestResponse({ description: 'Paginación inválida.' })
  listar(@Query() paginacion: Paginacion) {
    return this.packs.listar(paginacion);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver un pack (E3-H6)' })
  @ApiOkResponse({ description: 'El pack con sus componentes.' })
  @ApiNotFoundResponse({ description: 'El pack no existe.' })
  obtener(@Param('id', ID_PACK) id: number) {
    return this.packs.obtener(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Editar un pack (E3-H6)',
    description:
      'Solo se modifica lo que llega; `null` quita una fecha de vigencia y `componentes` reemplaza la lista completa con las mismas reglas que al crear.',
  })
  @ApiOkResponse({ description: 'Pack actualizado.' })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, cuerpo vacío, vigencia al revés o componentes no permitidos.',
  })
  @ApiNotFoundResponse({ description: 'El pack no existe.' })
  @ApiConflictResponse({ description: 'El SKU ya pertenece a otro artículo.' })
  actualizar(@Param('id', ID_PACK) id: number, @Body() dto: ActualizarPackDto) {
    return this.packs.actualizar(id, dto);
  }
}
