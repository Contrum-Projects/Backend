import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
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
import { Paginacion } from '../../common/validacion/paginacion.js';
import {
  type CampanaEnviada,
  CampanasService,
  type CorreoCampana,
  type DetalleCampana,
  type ListadoCampanas,
  type VistaPreviaCampana,
} from './campanas.service.js';
import { ActualizarCampanaDto } from './dto/actualizar-campana.dto.js';
import {
  CampanaEnviadaDto,
  DetalleCampanaDto,
  ListadoCampanasDto,
  VistaPreviaCampanaDto,
} from './dto/campana-respuesta.dto.js';
import { CrearCampanaDto } from './dto/crear-campana.dto.js';
import { EnviarCampanaDto } from './dto/enviar-campana.dto.js';
import {
  CorreoCampanaDto,
  RenderizarCampanaDto,
} from './dto/renderizar-campana.dto.js';

/** Id de la URL: un valor imposible responde 404 como uno inexistente. */
const ID_CAMPANA = new IdRutaPipe('La campaña no existe.');

/**
 * Campañas de correo del panel (E12-H3). Solo con `campanas.gestionar` (administrador). Se
 * identifican con su id: no tienen `codigoPublico` y solo las ve el panel (decisión del 5 nov).
 */
@ApiTags('marketing')
@ApiBearerAuth()
@Controller('marketing/campanas')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.CAMPANAS_GESTIONAR)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de gestionar campañas.',
})
export class CampanasController {
  constructor(private readonly campanas: CampanasService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Redactar una campaña de correo (E12-H3)',
    description:
      'Asunto, cuerpo en texto plano y segmento. Queda como borrador hasta confirmar el envío.',
  })
  @ApiCreatedResponse({
    description: 'Campaña creada como borrador.',
    type: DetalleCampanaDto,
  })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, categorías o marcas que no existen, o suscriptores con un filtro de compras.',
  })
  crear(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: CrearCampanaDto,
  ): Promise<DetalleCampana> {
    return this.campanas.crear(dto, usuario.codigoPublico);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar las campañas de correo (E12-H3)',
    description:
      'De la más nueva a la más antigua, con su estado de envío, a cuántas direcciones va o fue y su apertura, más los contadores de contactos con consentimiento.',
  })
  @ApiOkResponse({
    description: 'Página de campañas.',
    type: ListadoCampanasDto,
  })
  @ApiBadRequestResponse({ description: 'Paginación inválida.' })
  listar(@Query() paginacion: Paginacion): Promise<ListadoCampanas> {
    return this.campanas.listar(paginacion);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ver una campaña de correo (E12-H3)',
    description:
      'Incluye el segmento usado y cuántos correos quedaron pendientes, enviados, fallidos o cancelados.',
  })
  @ApiOkResponse({ description: 'Campaña.', type: DetalleCampanaDto })
  @ApiNotFoundResponse({ description: 'La campaña no existe.' })
  obtener(@Param('id', ID_CAMPANA) id: number): Promise<DetalleCampana> {
    return this.campanas.obtener(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Editar el borrador de una campaña (E12-H3)',
    description:
      'Cambia el asunto, el cuerpo o el segmento. Una campaña ya enviada no se edita.',
  })
  @ApiOkResponse({
    description: 'Campaña actualizada.',
    type: DetalleCampanaDto,
  })
  @ApiBadRequestResponse({ description: 'Datos inválidos o cuerpo vacío.' })
  @ApiNotFoundResponse({ description: 'La campaña no existe.' })
  @ApiConflictResponse({ description: 'La campaña ya fue enviada.' })
  actualizar(
    @Param('id', ID_CAMPANA) id: number,
    @Body() dto: ActualizarCampanaDto,
  ): Promise<DetalleCampana> {
    return this.campanas.actualizar(id, dto);
  }

  @Post('vista-previa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Vista previa en vivo de un correo de campaña (SCRUM-150)',
    description:
      'Arma el correo con el asunto y el cuerpo que se están escribiendo, sin guardarlos. No cuenta destinatarios ni entrega la `confirmacion`: para enviar se guarda el borrador y se pide `POST /:id/vista-previa`.',
  })
  @ApiOkResponse({ description: 'Correo armado.', type: CorreoCampanaDto })
  @ApiBadRequestResponse({ description: 'Asunto o cuerpo inválidos.' })
  vistaPreviaEnVivo(@Body() dto: RenderizarCampanaDto): CorreoCampana {
    return this.campanas.renderizar(dto);
  }

  @Post(':id/vista-previa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Vista previa de una campaña (E12-H3)',
    description:
      'Devuelve el correo (HTML y texto), cuántas direcciones lo recibirían hoy y la `confirmacion` que exige el envío.',
  })
  @ApiOkResponse({ description: 'Vista previa.', type: VistaPreviaCampanaDto })
  @ApiNotFoundResponse({ description: 'La campaña no existe.' })
  @ApiConflictResponse({ description: 'La campaña ya fue enviada.' })
  vistaPrevia(
    @Param('id', ID_CAMPANA) id: number,
  ): Promise<VistaPreviaCampana> {
    return this.campanas.vistaPrevia(id);
  }

  @Post(':id/envio')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Confirmar el envío de una campaña (E12-H3)',
    description:
      'Encola la campaña para las direcciones del segmento que aceptan publicidad, una vez cada una, y guarda el segmento usado. Sale una sola vez.',
  })
  @ApiAcceptedResponse({
    description: 'Campaña encolada.',
    type: CampanaEnviadaDto,
  })
  @ApiBadRequestResponse({ description: 'Falta la confirmación.' })
  @ApiNotFoundResponse({ description: 'La campaña no existe.' })
  @ApiConflictResponse({
    description:
      'Ya fue enviada, cambió después de la vista previa o no tiene destinatarios.',
  })
  enviar(
    @Param('id', ID_CAMPANA) id: number,
    @Body() dto: EnviarCampanaDto,
  ): Promise<CampanaEnviada> {
    return this.campanas.enviar(id, dto.confirmacion);
  }
}
