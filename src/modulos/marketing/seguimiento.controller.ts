import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Redirect,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { LIMITES } from '../../limites/limites.js';
import { SeguimientoService } from './seguimiento.service.js';

/** GIF transparente de 1×1: lo que carga el programa de correo al abrir la publicidad. */
export const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

/**
 * Rutas públicas a las que llevan la imagen y los enlaces de un correo publicitario (E12-H6). Sin
 * JWT: las protege la firma del enlace (`FirmaSeguimiento`). Responden lo mismo con una firma
 * inválida.
 */
@ApiTags('marketing')
@Controller('marketing/seguimiento')
@UseGuards(ThrottlerGuard)
@Throttle({ default: LIMITES.SEGUIMIENTO_CORREO })
@ApiTooManyRequestsResponse({
  description: 'Más de 120 peticiones por minuto desde la misma IP.',
})
export class SeguimientoController {
  constructor(private readonly seguimiento: SeguimientoService) {}

  @Get('apertura/:token')
  @Header('Content-Type', 'image/gif')
  @Header('Cache-Control', 'no-store, max-age=0')
  @ApiOperation({
    summary: 'Registrar la apertura de un correo publicitario (E12-H6)',
    description:
      'La imagen invisible del correo. Guarda la fecha de la primera apertura; las siguientes no la cambian. Siempre responde la imagen, aunque el enlace no sea válido.',
  })
  @ApiProduces('image/gif')
  @ApiOkResponse({ description: 'GIF transparente de 1×1.' })
  async apertura(@Param('token') token: string): Promise<StreamableFile> {
    await this.seguimiento.registrarApertura(token);
    return new StreamableFile(PIXEL_GIF);
  }

  @Get('clic/:token')
  @Redirect()
  @Header('Cache-Control', 'no-store, max-age=0')
  @ApiOperation({
    summary:
      'Registrar el clic en un enlace de un correo publicitario (E12-H6)',
    description:
      'Guarda la fecha del primer clic (y la de apertura, si no estaba) y redirige al destino, que debe ser de la tienda. Un destino de otro sitio lleva a la portada de la tienda; un enlace no válido redirige sin registrar.',
  })
  @ApiFoundResponse({ description: 'Redirige al destino del enlace.' })
  async clic(
    @Param('token') token: string,
    @Query('destino') destino: unknown,
  ): Promise<{ url: string; statusCode: number }> {
    const url = await this.seguimiento.registrarClic(token, destino);
    return { url, statusCode: 302 };
  }
}
