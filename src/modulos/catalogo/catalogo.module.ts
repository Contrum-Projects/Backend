import { Module } from '@nestjs/common';
import { AlmacenModule } from '../../almacen/almacen.module.js';
import { CacheCatalogo } from './cache-catalogo.js';
import { CategoriasController } from './categorias.controller.js';
import { CategoriasService } from './categorias.service.js';
import { FormatosController } from './formatos.controller.js';
import { FormatosService } from './formatos.service.js';
import { ImagenesController } from './imagenes.controller.js';
import { ImagenesService } from './imagenes.service.js';
import { MarcasController } from './marcas.controller.js';
import { MarcasService } from './marcas.service.js';
import { PacksController } from './packs.controller.js';
import { PacksService } from './packs.service.js';
import { PreciosController } from './precios.controller.js';
import { PreciosService } from './precios.service.js';
import { ProductosController } from './productos.controller.js';
import { ProductosService } from './productos.service.js';
import { TiendaPacksService } from './tienda-packs.service.js';
import { TiendaController } from './tienda.controller.js';
import { TiendaService } from './tienda.service.js';

/** Épicas 2 y 3: catálogo público y administración del catálogo (ver src/modulos/README.md). */
@Module({
  imports: [AlmacenModule],
  controllers: [
    MarcasController,
    CategoriasController,
    ProductosController,
    FormatosController,
    ImagenesController,
    PacksController,
    PreciosController,
    TiendaController,
  ],
  providers: [
    CacheCatalogo,
    MarcasService,
    CategoriasService,
    ProductosService,
    FormatosService,
    ImagenesService,
    PacksService,
    PreciosService,
    TiendaService,
    TiendaPacksService,
  ],
  exports: [MarcasService, CategoriasService],
})
export class CatalogoModule {}
