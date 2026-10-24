import { Module } from '@nestjs/common';
import { CacheCatalogo } from './cache-catalogo.js';
import { CategoriasController } from './categorias.controller.js';
import { CategoriasService } from './categorias.service.js';
import { MarcasController } from './marcas.controller.js';
import { MarcasService } from './marcas.service.js';
import { ProductosController } from './productos.controller.js';
import { ProductosService } from './productos.service.js';
import { TiendaController } from './tienda.controller.js';
import { TiendaService } from './tienda.service.js';

/** Épicas 2 y 3: catálogo público y administración del catálogo (ver src/modulos/README.md). */
@Module({
  controllers: [
    MarcasController,
    CategoriasController,
    ProductosController,
    TiendaController,
  ],
  providers: [
    CacheCatalogo,
    MarcasService,
    CategoriasService,
    ProductosService,
    TiendaService,
  ],
  exports: [MarcasService, CategoriasService],
})
export class CatalogoModule {}
