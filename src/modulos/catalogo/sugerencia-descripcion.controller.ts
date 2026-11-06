import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAutenticacionGuard } from '../../autenticacion/jwt-autenticacion.guard.js';
import {
  PermisosGuard,
  RequierePermiso,
} from '../../autenticacion/permisos.guard.js';
import { PERMISOS } from '../../common/dominio/permisos.js';
import { LimitePorCuentaGuard } from '../../limites/limite-por-cuenta.guard.js';
import { LIMITES } from '../../limites/limites.js';
import type { ArchivoSubido } from './imagenes.service.js';
import {
  CAMPO_IMAGEN,
  SubidaImagenInterceptor,
} from './subida-imagen.interceptor.js';
import { SugerenciaDescripcionService } from './sugerencia-descripcion.service.js';

@ApiTags('catalogo')
@ApiBearerAuth()
@Controller('catalogo/descripciones')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.CATALOGO_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar el catálogo.',
})
export class SugerenciaDescripcionController {
  constructor(private readonly sugerencias: SugerenciaDescripcionService) {}

  @Post('sugerencia')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LimitePorCuentaGuard)
  @Throttle({ default: LIMITES.SUGERIR_DESCRIPCION })
  @UseInterceptors(SubidaImagenInterceptor)
  @ApiOperation({
    summary:
      'Sugerir la descripción y los ingredientes desde la foto del reverso (E4-H1)',
    description:
      'Recibe la foto del reverso del producto (JPEG, PNG o WebP de hasta 4 MB) en el campo `imagen` y devuelve una descripción de venta sugerida y los ingredientes transcritos, para revisarlos antes de guardarlos. No guarda la foto ni la sugerencia. `ingredientes` es `null` si la foto no los muestra. Hasta 15 por minuto por cuenta.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [CAMPO_IMAGEN],
      properties: { [CAMPO_IMAGEN]: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({
    description: 'Descripción e ingredientes sugeridos.',
    schema: {
      type: 'object',
      properties: {
        descripcion: { type: 'string' },
        ingredientes: { type: 'string', nullable: true },
        firma: {
          type: 'string',
          description:
            'Se reenvía en `sugerencia` al crear o editar el producto para registrar el origen de la descripción.',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Sin imagen, o el archivo no es JPEG, PNG ni WebP.',
  })
  @ApiPayloadTooLargeResponse({ description: 'La imagen supera los 4 MB.' })
  @ApiUnprocessableEntityResponse({
    description:
      'La foto no se puede leer; la descripción se puede escribir a mano.',
  })
  @ApiTooManyRequestsResponse({
    description: 'Más de 15 sugerencias en un minuto con la misma cuenta.',
  })
  @ApiServiceUnavailableResponse({
    description:
      'El servicio de IA no respondió o no está configurado; la descripción se puede escribir a mano.',
  })
  sugerir(@UploadedFile() archivo: ArchivoSubido | undefined) {
    return this.sugerencias.sugerir(archivo);
  }
}
