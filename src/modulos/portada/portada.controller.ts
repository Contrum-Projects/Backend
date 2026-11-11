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
  Put,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAutenticacionGuard } from '../../autenticacion/jwt-autenticacion.guard.js';
import {
  PermisosGuard,
  RequierePermiso,
} from '../../autenticacion/permisos.guard.js';
import { PERMISOS } from '../../common/dominio/permisos.js';
import {
  PAGINAS_PORTADA,
  TIPOS_DESTINO_PORTADA,
} from '../../common/dominio/valores.js';
import type { ArchivoSubido } from '../catalogo/imagenes.service.js';
import {
  CAMPO_IMAGEN,
  SubidaImagenInterceptor,
} from '../catalogo/subida-imagen.interceptor.js';
import { BuscarDestinosDto } from './dto/buscar-destinos.dto.js';
import { DestinoPortadaDto } from './dto/destino-portada.dto.js';
import { OrdenarSlidesDto } from './dto/ordenar-slides.dto.js';
import {
  OpcionDestinoDto,
  SlidePortadaDto,
  SlidePortadaPanelDto,
} from './dto/slide-portada.dto.js';
import { ID_SLIDE } from './ids-ruta.js';
import {
  MAXIMO_SLIDES_PORTADA,
  PortadaService,
  VERSIONES_IMAGEN,
} from './portada.service.js';
import { SubidaPortadaInterceptor } from './subida-portada.interceptor.js';

/** Portada del inicio que ve la tienda (SCRUM-157). Pública: no pide sesión. */
@ApiTags('portada')
@Controller('portada')
export class PortadaTiendaController {
  constructor(private readonly portada: PortadaService) {}

  @Get()
  @ApiOperation({
    summary: 'Slides de la portada del inicio (SCRUM-157)',
    description:
      'En su orden, solo los que llevan a un destino que cualquier visitante ve en la tienda (producto o pack de venta general y a la venta, marca activa, categoría existente o una página). Sin slides, lista vacía: la tienda muestra el banner del pack.',
  })
  @ApiOkResponse({ type: [SlidePortadaDto] })
  listar() {
    return this.portada.listarTienda();
  }
}

const SUBIDA_UNA_IMAGEN = {
  schema: {
    type: 'object' as const,
    required: [CAMPO_IMAGEN],
    properties: {
      [CAMPO_IMAGEN]: { type: 'string' as const, format: 'binary' },
    },
  },
};

type ArchivosSlide = Partial<Record<'escritorio' | 'celular', ArchivoSubido[]>>;

/** Gestión de la portada desde el panel (SCRUM-157): solo imágenes, orden y destino. */
@ApiTags('portada')
@ApiBearerAuth()
@Controller('portada')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.CAMPANAS_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar campañas.',
})
export class PortadaPanelController {
  constructor(private readonly portada: PortadaService) {}

  @Get('slides')
  @ApiOperation({
    summary: 'Listar los slides de la portada (SCRUM-157)',
    description:
      'Todos, en su orden, con `disponible` en falso cuando el destino ya no está a la venta (la tienda no lo muestra).',
  })
  @ApiOkResponse({ type: [SlidePortadaPanelDto] })
  listar() {
    return this.portada.listarPanel();
  }

  @Get('destinos')
  @ApiOperation({
    summary: 'Opciones de destino de un slide (SCRUM-157)',
    description: `Hasta 20 destinos del tipo pedido que la tienda muestra a cualquier visitante, por nombre; \`buscar\` filtra por nombre. Con \`tipo\` = \`pagina\`, las páginas: ${Object.values(PAGINAS_PORTADA).join(', ')}.`,
  })
  @ApiOkResponse({ type: [OpcionDestinoDto] })
  @ApiBadRequestResponse({ description: 'Tipo de destino inválido.' })
  destinos(@Query() filtro: BuscarDestinosDto) {
    return this.portada.opcionesDestino(filtro.tipo, filtro.buscar);
  }

  @Post('slides')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(SubidaPortadaInterceptor)
  @ApiOperation({
    summary: 'Agregar un slide a la portada (SCRUM-157)',
    description: `Imagen \`escritorio\` obligatoria y \`celular\` opcional (JPEG, PNG o WebP de hasta 4 MB cada una), con \`tipoDestino\` y \`destino\`. Queda al final. La portada tiene hasta ${MAXIMO_SLIDES_PORTADA} slides. Devuelve todos los slides.`,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [VERSIONES_IMAGEN.ESCRITORIO, 'tipoDestino', 'destino'],
      properties: {
        [VERSIONES_IMAGEN.ESCRITORIO]: { type: 'string', format: 'binary' },
        [VERSIONES_IMAGEN.CELULAR]: { type: 'string', format: 'binary' },
        tipoDestino: {
          type: 'string',
          enum: Object.values(TIPOS_DESTINO_PORTADA),
        },
        destino: { type: 'string' },
      },
    },
  })
  @ApiCreatedResponse({ type: [SlidePortadaPanelDto] })
  @ApiBadRequestResponse({
    description:
      'Falta la imagen de escritorio, una imagen no es JPEG, PNG ni WebP, o el destino no existe o no está a la venta.',
  })
  @ApiPayloadTooLargeResponse({ description: 'Una imagen supera los 4 MB.' })
  @ApiConflictResponse({
    description: `La portada ya tiene ${MAXIMO_SLIDES_PORTADA} slides.`,
  })
  @ApiServiceUnavailableResponse({
    description: 'El almacenamiento de archivos no está configurado.',
  })
  crear(
    @Body() dto: DestinoPortadaDto,
    @UploadedFiles() archivos: ArchivosSlide | undefined,
  ) {
    return this.portada.crear(
      dto,
      archivos?.escritorio?.[0],
      archivos?.celular?.[0],
    );
  }

  @Put('slides/orden')
  @ApiOperation({
    summary: 'Ordenar los slides de la portada (SCRUM-157)',
    description: '`orden` trae todos los slides, cada uno una vez.',
  })
  @ApiOkResponse({ type: [SlidePortadaPanelDto] })
  @ApiBadRequestResponse({
    description: 'El orden no trae exactamente los slides de la portada.',
  })
  ordenar(@Body() dto: OrdenarSlidesDto) {
    return this.portada.ordenar(dto);
  }

  @Patch('slides/:id')
  @ApiOperation({ summary: 'Cambiar a dónde lleva un slide (SCRUM-157)' })
  @ApiOkResponse({ type: [SlidePortadaPanelDto] })
  @ApiBadRequestResponse({
    description: 'El destino no existe o no está a la venta.',
  })
  @ApiNotFoundResponse({ description: 'El slide no existe.' })
  cambiarDestino(
    @Param('id', ID_SLIDE) id: number,
    @Body() dto: DestinoPortadaDto,
  ) {
    return this.portada.cambiarDestino(id, dto);
  }

  @Put('slides/:id/imagenes/escritorio')
  @UseInterceptors(SubidaImagenInterceptor)
  @ApiOperation({
    summary: 'Reemplazar la imagen de escritorio de un slide (SCRUM-157)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(SUBIDA_UNA_IMAGEN)
  @ApiOkResponse({ type: [SlidePortadaPanelDto] })
  @ApiBadRequestResponse({
    description: 'Sin imagen, o no es JPEG, PNG ni WebP.',
  })
  @ApiPayloadTooLargeResponse({ description: 'La imagen supera los 4 MB.' })
  @ApiNotFoundResponse({ description: 'El slide no existe.' })
  reemplazarEscritorio(
    @Param('id', ID_SLIDE) id: number,
    @UploadedFile() archivo: ArchivoSubido | undefined,
  ) {
    return this.portada.reemplazarImagen(
      id,
      VERSIONES_IMAGEN.ESCRITORIO,
      archivo,
    );
  }

  @Put('slides/:id/imagenes/celular')
  @UseInterceptors(SubidaImagenInterceptor)
  @ApiOperation({
    summary: 'Subir o reemplazar la imagen de celular de un slide (SCRUM-157)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(SUBIDA_UNA_IMAGEN)
  @ApiOkResponse({ type: [SlidePortadaPanelDto] })
  @ApiBadRequestResponse({
    description: 'Sin imagen, o no es JPEG, PNG ni WebP.',
  })
  @ApiPayloadTooLargeResponse({ description: 'La imagen supera los 4 MB.' })
  @ApiNotFoundResponse({ description: 'El slide no existe.' })
  reemplazarCelular(
    @Param('id', ID_SLIDE) id: number,
    @UploadedFile() archivo: ArchivoSubido | undefined,
  ) {
    return this.portada.reemplazarImagen(id, VERSIONES_IMAGEN.CELULAR, archivo);
  }

  @Delete('slides/:id/imagenes/celular')
  @ApiOperation({
    summary: 'Quitar la imagen de celular de un slide (SCRUM-157)',
    description: 'El celular vuelve a mostrar la imagen de escritorio.',
  })
  @ApiOkResponse({ type: [SlidePortadaPanelDto] })
  @ApiNotFoundResponse({ description: 'El slide no existe.' })
  quitarCelular(@Param('id', ID_SLIDE) id: number) {
    return this.portada.quitarImagenCelular(id);
  }

  @Delete('slides/:id')
  @ApiOperation({
    summary: 'Eliminar un slide de la portada (SCRUM-157)',
    description: 'Los demás se reordenan sin huecos. Devuelve los que quedan.',
  })
  @ApiOkResponse({ type: [SlidePortadaPanelDto] })
  @ApiNotFoundResponse({ description: 'El slide no existe.' })
  eliminar(@Param('id', ID_SLIDE) id: number) {
    return this.portada.eliminar(id);
  }
}
