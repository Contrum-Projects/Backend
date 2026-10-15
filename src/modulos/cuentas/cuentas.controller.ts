import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CuentasService } from './cuentas.service.js';
import { ConfirmarCorreoDto } from './dto/confirmar-correo.dto.js';
import { RegistrarCuentaDto } from './dto/registrar-cuenta.dto.js';

@ApiTags('cuentas')
@Controller('cuentas')
export class CuentasController {
  constructor(private readonly cuentas: CuentasService) {}

  @Post('registro')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar una cuenta de cliente (E1-H1)',
    description:
      'Crea la cuenta con el correo sin verificar y envía el enlace de confirmación.',
  })
  @ApiCreatedResponse({ description: 'Cuenta creada; correo encolado.' })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o contraseñas distintas.',
  })
  @ApiConflictResponse({
    description: 'El correo o el RUT ya está registrado.',
  })
  registrar(@Body() dto: RegistrarCuentaDto) {
    return this.cuentas.registrar(dto);
  }

  @Post('confirmar-correo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirmar el correo con el token del enlace (E1-H1)',
  })
  @ApiOkResponse({ description: 'Correo verificado.' })
  @ApiBadRequestResponse({ description: 'Enlace inválido, usado o vencido.' })
  confirmarCorreo(@Body() dto: ConfirmarCorreoDto) {
    return this.cuentas.confirmarCorreo(dto.token);
  }
}
