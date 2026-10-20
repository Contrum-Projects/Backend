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
import { CrearProveedorDto } from './dto/crear-proveedor.dto.js';
import { ProveedoresService } from './proveedores.service.js';

@ApiTags('inventario')
@ApiBearerAuth()
@Controller('inventario/proveedores')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.PROVEEDORES_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de proveedores.',
})
export class ProveedoresController {
  constructor(private readonly proveedores: ProveedoresService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar un proveedor (E11-H1)',
    description:
      'Guarda el proveedor con su RUT, razón social y datos de contacto, y queda disponible para las entradas de inventario.',
  })
  @ApiCreatedResponse({ description: 'Proveedor registrado.' })
  @ApiBadRequestResponse({ description: 'Datos inválidos.' })
  @ApiConflictResponse({ description: 'Ya existe un proveedor con ese RUT.' })
  crear(@Body() dto: CrearProveedorDto) {
    return this.proveedores.crear(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar proveedores',
    description: 'Por defecto solo los activos, ordenados por razón social.',
  })
  @ApiQuery({
    name: 'incluirInactivos',
    required: false,
    type: Boolean,
    description: 'Con `true` incluye también los proveedores desactivados.',
  })
  @ApiOkResponse({ description: 'Lista de proveedores.' })
  listar(@Query('incluirInactivos') incluirInactivos?: string) {
    return this.proveedores.listar(incluirInactivos === 'true');
  }
}
