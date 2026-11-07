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
import { IdRutaPipe } from '../../common/validacion/id-ruta.pipe.js';
import { type CuponPanel, CuponesService } from './cupones.service.js';
import { CuponPanelDto } from './dto/cupon-respuesta.dto.js';
import { ActualizarCuponDto, CrearCuponDto } from './dto/cupon.dto.js';

const ID_CUPON = new IdRutaPipe('El cupón no existe.');

/**
 * Cupones de descuento del panel (SCRUM-150). Con `campanas.gestionar` (administrador), como las
 * campañas a las que pueden ir ligados. Se identifican con su id: solo los ve el panel.
 */
@ApiTags('marketing')
@ApiBearerAuth()
@Controller('marketing/cupones')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.CAMPANAS_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar campañas.',
})
export class CuponesController {
  constructor(private readonly cupones: CuponesService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar los cupones (SCRUM-150)',
    description: 'Del más nuevo al más antiguo, con sus usos y lo descontado.',
  })
  @ApiOkResponse({ type: [CuponPanelDto] })
  listar(): Promise<CuponPanel[]> {
    return this.cupones.listar();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver un cupón (SCRUM-150)' })
  @ApiOkResponse({ type: CuponPanelDto })
  @ApiNotFoundResponse({ description: 'El cupón no existe.' })
  obtener(@Param('id', ID_CUPON) id: number): Promise<CuponPanel> {
    return this.cupones.obtener(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear un cupón (SCRUM-150)',
    description:
      'Porcentaje (con tope opcional) o monto fijo, sobre todo el pedido, ciertos formatos o packs, o categorías y marcas. Con `campanaId`, solo lo usan las cuentas a las que se envió esa campaña.',
  })
  @ApiCreatedResponse({ type: CuponPanelDto })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, reglas que no calzan entre sí, o artículos, categorías, marcas o campaña que no existen.',
  })
  @ApiConflictResponse({ description: 'Ya existe un cupón con ese código.' })
  crear(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: CrearCuponDto,
  ): Promise<CuponPanel> {
    return this.cupones.crear(dto, usuario.codigoPublico);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Editar o desactivar un cupón (SCRUM-150)',
    description:
      'Cada campo que llega reemplaza al anterior. Los pedidos que ya lo usaron conservan su descuento.',
  })
  @ApiOkResponse({ type: CuponPanelDto })
  @ApiBadRequestResponse({ description: 'Datos inválidos.' })
  @ApiNotFoundResponse({ description: 'El cupón no existe.' })
  @ApiConflictResponse({ description: 'Ya existe un cupón con ese código.' })
  actualizar(
    @Param('id', ID_CUPON) id: number,
    @Body() dto: ActualizarCuponDto,
  ): Promise<CuponPanel> {
    return this.cupones.actualizar(id, dto);
  }
}
