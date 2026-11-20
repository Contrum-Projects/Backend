import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import {
  SesionOpcionalGuard,
  UsuarioOpcional,
} from '../../autenticacion/sesion-opcional.guard.js';
import { codigoDeLaPeticion } from '../../common/errores/codigo-seguimiento.js';
import { LIMITES } from '../../limites/limites.js';
import {
  ReporteErrorClienteDto,
  RespuestaReporteErrorDto,
} from './dto/reporte-error-cliente.dto.js';
import { RegistroErroresService } from './registro-errores.service.js';

/** La tienda y el panel informan sus errores (SCRUM-168). Pública: el visitante también falla. */
@ApiTags('registros')
@Controller('registros/errores-cliente')
@UseGuards(ThrottlerGuard, SesionOpcionalGuard)
@Throttle({ default: LIMITES.REPORTAR_ERROR })
@ApiTooManyRequestsResponse({
  description: 'Más de 30 reportes por minuto desde la misma IP.',
})
export class ErroresClienteController {
  constructor(private readonly registro: RegistroErroresService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar un error de la tienda o del panel (SCRUM-168)',
    description:
      'Guarda qué pasó, cuándo y en qué pantalla en el registro de errores. Si llega el token de acceso, asocia la cuenta.',
  })
  @ApiCreatedResponse({ type: RespuestaReporteErrorDto })
  @ApiBadRequestResponse({
    description: 'Reporte incompleto o demasiado largo.',
  })
  registrar(
    @Body() dto: ReporteErrorClienteDto,
    @Req() peticion: Request & { id?: unknown },
    @UsuarioOpcional() usuario: UsuarioAutenticado | undefined,
  ): Promise<RespuestaReporteErrorDto> {
    return this.registro.registrarDelCliente(
      dto,
      codigoDeLaPeticion(peticion),
      usuario?.codigoPublico,
    );
  }
}
