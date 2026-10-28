import {
  Body,
  Controller,
  Delete,
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
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import { CompradorGuard } from '../../autenticacion/comprador.guard.js';
import {
  JwtAutenticacionGuard,
  UsuarioActual,
} from '../../autenticacion/jwt-autenticacion.guard.js';
import { IdRutaPipe } from '../../common/validacion/id-ruta.pipe.js';
import {
  type DatosFacturacionCuenta,
  DatosFacturacionService,
} from './datos-facturacion.service.js';
import {
  ActualizarDatosFacturacionDto,
  CrearDatosFacturacionDto,
} from './dto/guardar-datos-facturacion.dto.js';

const idRegistro = new IdRutaPipe('Los datos de facturación no existen.');

/**
 * Datos de facturación de la cuenta con la sesión iniciada. Se identifican por su id, siempre
 * dentro de la cuenta del token: los de otra cuenta responden 404, igual que las direcciones.
 */
@ApiTags('cuentas')
@ApiBearerAuth()
@Controller('cuentas/yo/facturacion')
@UseGuards(JwtAutenticacionGuard, CompradorGuard)
@ApiUnauthorizedResponse({ description: 'Sin sesión válida.' })
@ApiForbiddenResponse({ description: 'Cuenta del personal de tienda.' })
export class DatosFacturacionController {
  constructor(private readonly datos: DatosFacturacionService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar mis datos de facturación (E9-H2)',
    description:
      'Todos los registros activos, para elegir uno al pedir factura.',
  })
  @ApiOkResponse({ description: 'Registros de facturación de la cuenta.' })
  listar(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<DatosFacturacionCuenta[]> {
    return this.datos.listar(usuario.codigoPublico);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Guardar datos de facturación (E9-H2)' })
  @ApiCreatedResponse({ description: 'Datos guardados.' })
  @ApiBadRequestResponse({
    description:
      'Falta algún dato obligatorio, hay datos inválidos o la comuna no existe. El mensaje indica cuáles.',
  })
  crear(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: CrearDatosFacturacionDto,
  ): Promise<DatosFacturacionCuenta> {
    return this.datos.crear(usuario.codigoPublico, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar datos de facturación (E9-H2)' })
  @ApiOkResponse({ description: 'Datos guardados.' })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o comuna inexistente.',
  })
  @ApiNotFoundResponse({
    description: 'El registro no es de la cuenta o ya fue eliminado.',
  })
  actualizar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idRegistro) id: number,
    @Body() dto: ActualizarDatosFacturacionDto,
  ): Promise<DatosFacturacionCuenta> {
    return this.datos.actualizar(usuario.codigoPublico, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Eliminar datos de facturación (E9-H2)',
    description:
      'Dejan de aparecer en la lista de la cuenta. Los pedidos que los usaron no cambian.',
  })
  @ApiNoContentResponse({ description: 'Datos eliminados de la lista.' })
  @ApiNotFoundResponse({
    description: 'El registro no es de la cuenta o ya fue eliminado.',
  })
  eliminar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idRegistro) id: number,
  ): Promise<void> {
    return this.datos.desactivar(usuario.codigoPublico, id);
  }
}
