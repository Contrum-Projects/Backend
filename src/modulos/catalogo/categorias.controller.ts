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
import { CategoriasService } from './categorias.service.js';
import { ActualizarCategoriaDto } from './dto/actualizar-categoria.dto.js';
import { CrearCategoriaDto } from './dto/crear-categoria.dto.js';
import { ID_CATEGORIA } from './ids-ruta.js';

@ApiTags('catalogo')
@ApiBearerAuth()
@Controller('catalogo/categorias')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.CATALOGO_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar el catálogo.',
})
export class CategoriasController {
  constructor(private readonly categorias: CategoriasService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear una categoría o subcategoría (E3-H4)',
    description:
      'Con `padreId` crea una subcategoría dentro de esa categoría; sin él, una categoría raíz.',
  })
  @ApiCreatedResponse({ description: 'Categoría creada.' })
  @ApiBadRequestResponse({ description: 'Datos inválidos.' })
  @ApiNotFoundResponse({ description: 'La categoría padre no existe.' })
  crear(@Body() dto: CrearCategoriaDto) {
    return this.categorias.crear(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar el árbol de categorías',
    description:
      'Categorías raíz con sus subcategorías anidadas, ordenadas por nombre.',
  })
  @ApiOkResponse({ description: 'Árbol de categorías.' })
  listar() {
    return this.categorias.listarArbol();
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Editar o mover una categoría (E3-H4)',
    description:
      'Cambia el nombre, la descripción o el padre. `padreId: null` la deja como categoría raíz. Se rechaza mover una categoría dentro de ella misma o de una de sus subcategorías.',
  })
  @ApiOkResponse({ description: 'Categoría actualizada.' })
  @ApiBadRequestResponse({ description: 'Datos inválidos o cuerpo vacío.' })
  @ApiNotFoundResponse({
    description: 'La categoría o su nuevo padre no existe.',
  })
  @ApiConflictResponse({ description: 'El movimiento formaría un ciclo.' })
  actualizar(
    @Param('id', ID_CATEGORIA) id: number,
    @Body() dto: ActualizarCategoriaDto,
  ) {
    return this.categorias.actualizar(id, dto);
  }
}
