import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Booleano } from '../../../common/validacion/booleano.js';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { Paginacion } from '../../../common/validacion/paginacion.js';
import { TextoBusqueda } from '../../../common/validacion/texto-busqueda.js';

/** Filtros y paginación del listado de productos del panel (E3-H1). */
export class ListarProductosDto extends Paginacion {
  @ApiPropertyOptional({
    description: 'Texto contenido en el nombre, sin distinguir mayúsculas.',
    maxLength: 200,
  })
  @TextoBusqueda({ maximo: 200 })
  buscar?: string;

  @ApiPropertyOptional({ description: 'Solo productos de esta categoría.' })
  @Type(() => Number)
  @IdEntero({
    faltante: 'La categoría indicada no es válida.',
    invalido: 'La categoría indicada no es válida.',
    opcional: true,
  })
  categoriaId?: number;

  @ApiPropertyOptional({ description: 'Solo productos de esta marca.' })
  @Type(() => Number)
  @IdEntero({
    faltante: 'La marca indicada no es válida.',
    invalido: 'La marca indicada no es válida.',
    opcional: true,
  })
  marcaId?: number;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Con `true` incluye también los productos desactivados.',
  })
  @Booleano({ etiqueta: 'Incluir inactivos', desdeTexto: true })
  incluirInactivos?: boolean;
}
