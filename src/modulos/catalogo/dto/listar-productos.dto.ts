import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Booleano } from '../../../common/validacion/booleano.js';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { Paginacion } from '../../../common/validacion/paginacion.js';
import { TextoBusqueda } from '../../../common/validacion/texto-busqueda.js';
import { CANALES_VENTA } from '../../../common/dominio/valores.js';
import { CanalVenta } from './canal-venta.decorator.js';

/** Filtros y paginación del listado de productos del panel (E3-H1). */
export class ListarProductosDto extends Paginacion {
  @ApiPropertyOptional({
    description:
      'Texto contenido en el nombre, la marca o el SKU de un formato, sin distinguir mayúsculas.',
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

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Con `true`, solo los productos desactivados (SCRUM-150).',
  })
  @Booleano({ etiqueta: 'Solo inactivos', desdeTexto: true })
  soloInactivos?: boolean;

  @ApiPropertyOptional({
    enum: Object.values(CANALES_VENTA),
    description:
      'Solo los productos de este canal; `profesional` son los exclusivos (SCRUM-150).',
  })
  @CanalVenta({ puedeFaltar: true })
  canalVenta?: (typeof CANALES_VENTA)[keyof typeof CANALES_VENTA];

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Con `true`, solo los que tienen algún formato bajo su stock mínimo (SCRUM-150).',
  })
  @Booleano({ etiqueta: 'Stock bajo', desdeTexto: true })
  stockBajo?: boolean;
}
