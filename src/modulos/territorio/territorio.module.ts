import { Module } from '@nestjs/common';
import { TerritorioController } from './territorio.controller.js';
import { TerritorioService } from './territorio.service.js';

/** Transversal: regiones y comunas de la lista oficial (ver src/modulos/README.md). */
@Module({
  controllers: [TerritorioController],
  providers: [TerritorioService],
  exports: [TerritorioService],
})
export class TerritorioModule {}
