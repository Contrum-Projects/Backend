import { Module } from '@nestjs/common';
import { CategoriasController } from './categorias.controller.js';
import { CategoriasService } from './categorias.service.js';
import { MarcasController } from './marcas.controller.js';
import { MarcasService } from './marcas.service.js';

/** Épicas 2 y 3: catálogo público y administración del catálogo (ver src/modulos/README.md). */
@Module({
  controllers: [MarcasController, CategoriasController],
  providers: [MarcasService, CategoriasService],
  // Los productos (E3-H1) validan la marca y la categoría que reciben
  exports: [MarcasService, CategoriasService],
})
export class CatalogoModule {}
