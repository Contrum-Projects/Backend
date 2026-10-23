import { Module } from '@nestjs/common';
import { CategoriasController } from './categorias.controller.js';
import { CategoriasService } from './categorias.service.js';
import { MarcasController } from './marcas.controller.js';
import { MarcasService } from './marcas.service.js';
import { ProductosController } from './productos.controller.js';
import { ProductosService } from './productos.service.js';

/** Épicas 2 y 3: catálogo público y administración del catálogo (ver src/modulos/README.md). */
@Module({
  controllers: [MarcasController, CategoriasController, ProductosController],
  providers: [MarcasService, CategoriasService, ProductosService],
  exports: [MarcasService, CategoriasService],
})
export class CatalogoModule {}
