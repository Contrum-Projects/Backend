import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UploadedFile,
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
import { OrdenarImagenesDto } from './dto/ordenar-imagenes.dto.js';
import { ID_ARTICULO, ID_IMAGEN } from './ids-ruta.js';
import { type ArchivoSubido, ImagenesService } from './imagenes.service.js';
import {
  CAMPO_IMAGEN,
  SubidaImagenInterceptor,
} from './subida-imagen.interceptor.js';

@ApiTags('catalogo')
@ApiBearerAuth()
@Controller('catalogo/articulos/:id/imagenes')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.CATALOGO_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar el catálogo.',
})
@ApiNotFoundResponse({ description: 'El artículo o la imagen no existe.' })
export class ImagenesController {
  constructor(private readonly imagenes: ImagenesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(SubidaImagenInterceptor)
  @ApiOperation({
    summary: 'Subir una imagen a un artículo (E3-H3)',
    description:
      'Recibe una imagen JPEG, PNG o WebP de hasta 5 MB en el campo `imagen` (el tipo se reconoce por el contenido, no por la extensión). Queda al final del orden; la primera del artículo queda como principal. Un artículo tiene hasta 10 imágenes. El id del artículo es el del formato. Devuelve todas las imágenes del artículo.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [CAMPO_IMAGEN],
      properties: { [CAMPO_IMAGEN]: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ description: 'Imagen agregada.' })
  @ApiBadRequestResponse({
    description: 'Sin imagen, o el archivo no es JPEG, PNG ni WebP.',
  })
  @ApiPayloadTooLargeResponse({ description: 'La imagen supera los 5 MB.' })
  @ApiConflictResponse({ description: 'El artículo ya tiene 10 imágenes.' })
  @ApiServiceUnavailableResponse({
    description: 'El almacenamiento de imágenes no está configurado.',
  })
  subir(
    @Param('id', ID_ARTICULO) articuloId: number,
    @UploadedFile() archivo: ArchivoSubido | undefined,
  ) {
    return this.imagenes.subir(articuloId, archivo);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar las imágenes de un artículo (E3-H3)',
    description: 'En el orden en que se muestran, con su URL pública.',
  })
  @ApiOkResponse({ description: 'Imágenes del artículo.' })
  listar(@Param('id', ID_ARTICULO) articuloId: number) {
    return this.imagenes.listar(articuloId);
  }

  @Put()
  @ApiOperation({
    summary: 'Ordenar las imágenes y elegir la principal (E3-H3)',
    description:
      '`orden` trae todas las imágenes del artículo, cada una una vez, en el nuevo orden; `principalId` queda como la única principal.',
  })
  @ApiOkResponse({ description: 'Imágenes en su nuevo orden.' })
  @ApiBadRequestResponse({
    description:
      'El orden no trae exactamente las imágenes del artículo, o la principal no es una de ellas.',
  })
  ordenar(
    @Param('id', ID_ARTICULO) articuloId: number,
    @Body() dto: OrdenarImagenesDto,
  ) {
    return this.imagenes.ordenar(articuloId, dto);
  }

  @Delete(':imagenId')
  @ApiOperation({
    summary: 'Eliminar una imagen de un artículo (E3-H3)',
    description:
      'Las demás se reordenan sin huecos; si era la principal, la siguiente pasa a serlo. La única imagen del artículo no se puede eliminar. Devuelve las imágenes que quedan.',
  })
  @ApiOkResponse({ description: 'Imagen eliminada.' })
  @ApiConflictResponse({
    description: 'Es la única imagen del artículo.',
  })
  eliminar(
    @Param('id', ID_ARTICULO) articuloId: number,
    @Param('imagenId', ID_IMAGEN) imagenId: number,
  ) {
    return this.imagenes.eliminar(articuloId, imagenId);
  }
}
