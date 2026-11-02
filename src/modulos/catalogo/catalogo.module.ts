import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlmacenModule } from '../../almacen/almacen.module.js';
import type { Entorno } from '../../config/entorno.js';
import { CacheCatalogo } from './cache-catalogo.js';
import { CategoriasController } from './categorias.controller.js';
import { CategoriasService } from './categorias.service.js';
import {
  CLIENTE_IA,
  type ClienteIa,
  ClienteGemini,
  ClienteIaNoConfigurado,
} from './cliente-ia.js';
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
import { SugerenciaDescripcionController } from './sugerencia-descripcion.controller.js';
import { SugerenciaDescripcionService } from './sugerencia-descripcion.service.js';
import { TiendaDetalleService } from './tienda-detalle.service.js';
import { TiendaPacksService } from './tienda-packs.service.js';
import { TiendaController } from './tienda.controller.js';
import { TiendaService } from './tienda.service.js';

/**
 * Épicas 2, 3 y 4: catálogo público, administración del catálogo y descripciones con IA (ver
 * src/modulos/README.md).
 */
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
    SugerenciaDescripcionController,
    TiendaController,
  ],
  providers: [
    {
      provide: CLIENTE_IA,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Entorno, true>): ClienteIa => {
        const clave = config.get('GEMINI_API_KEY', { infer: true });
        return clave
          ? new ClienteGemini(
              clave,
              config.get('GEMINI_MODELO', { infer: true }),
            )
          : new ClienteIaNoConfigurado();
      },
    },
    CacheCatalogo,
    MarcasService,
    CategoriasService,
    ProductosService,
    FormatosService,
    ImagenesService,
    PacksService,
    PreciosService,
    SugerenciaDescripcionService,
    TiendaService,
    TiendaPacksService,
    TiendaDetalleService,
  ],
  exports: [MarcasService, CategoriasService],
})
export class CatalogoModule {}
