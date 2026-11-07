import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Booleano } from '../../../common/validacion/booleano.js';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { Paginacion } from '../../../common/validacion/paginacion.js';
import { TextoBusqueda } from '../../../common/validacion/texto-busqueda.js';

/** Filtros y paginación del listado de stock del panel (E11-H5 criterio 1, SCRUM-150). */
export class ListarStockDto extends Paginacion {
  @ApiPropertyOptional({
    description:
      'Solo los formatos con unidades en esta bodega; las ubicaciones y el stock de cada fila son los de ella.',
  })
  @Type(() => Number)
  @IdEntero({
    faltante: 'La bodega indicada no es válida.',
    invalido: 'La bodega indicada no es válida.',
    opcional: true,
  })
  bodegaId?: number;

  @ApiPropertyOptional({
    description:
      'Texto contenido en el nombre del producto, el del formato o el SKU, sin distinguir mayúsculas.',
    maxLength: 200,
  })
  @TextoBusqueda({ maximo: 200 })
  buscar?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Con `true`, solo los formatos bajo su stock mínimo.',
  })
  @Booleano({ etiqueta: 'Bajo el mínimo', desdeTexto: true })
  bajoMinimo?: boolean;
}
