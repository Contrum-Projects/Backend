import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { FechaSinHora } from '../../../common/validacion/fecha-sin-hora.js';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { Paginacion } from '../../../common/validacion/paginacion.js';
import { TextoBusqueda } from '../../../common/validacion/texto-busqueda.js';

/** Filtros y paginación de las entradas del panel (E11-H2 criterio 1, SCRUM-150). */
export class ListarEntradasDto extends Paginacion {
  @ApiPropertyOptional({
    description: 'Solo las entradas recibidas en una ubicación de esta bodega.',
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
      'Texto contenido en la razón social del proveedor o en el número de documento.',
    maxLength: 200,
  })
  @TextoBusqueda({ maximo: 200 })
  buscar?: string;

  @ApiPropertyOptional({
    example: '2026-11-01',
    format: 'date',
    description: 'Recibidas desde este día.',
  })
  @FechaSinHora({ etiqueta: 'La fecha desde', presencia: 'puedeFaltar' })
  desde?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    format: 'date',
    description: 'Recibidas hasta este día incluido.',
  })
  @FechaSinHora({ etiqueta: 'La fecha hasta', presencia: 'puedeFaltar' })
  hasta?: string;
}
