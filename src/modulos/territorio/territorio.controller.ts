import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { UbicacionOficialDto } from './dto/ubicacion-oficial.dto.js';
import { TerritorioService } from './territorio.service.js';

/** Lista oficial de regiones y comunas: datos públicos, no pide sesión. */
@ApiTags('territorio')
@Controller('territorio')
export class TerritorioController {
  constructor(private readonly territorio: TerritorioService) {}

  @Get('regiones')
  @ApiOperation({
    summary: 'Listar las regiones',
    description:
      'Las 16 regiones de Chile de norte a sur, con su código CUT (decreto N° 1.115 de 2018).',
  })
  @ApiOkResponse({ type: [UbicacionOficialDto] })
  listarRegiones() {
    return this.territorio.listarRegiones();
  }

  @Get('regiones/:codigoCut/comunas')
  @ApiOperation({
    summary: 'Listar las comunas de una región',
    description:
      'Las comunas de la región, por nombre, con su código CUT. Las direcciones, el despacho y la facturación indican la comuna por ese código.',
  })
  @ApiParam({
    name: 'codigoCut',
    example: '13',
    description: 'Código CUT de la región.',
  })
  @ApiOkResponse({ type: [UbicacionOficialDto] })
  @ApiNotFoundResponse({ description: 'La región no existe.' })
  listarComunas(@Param('codigoCut') codigoCut: string) {
    return this.territorio.listarComunas(codigoCut);
  }
}
