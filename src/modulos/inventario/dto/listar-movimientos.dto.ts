import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { GRUPOS_MOVIMIENTO } from '../../../common/dominio/valores.js';
import { FechaSinHora } from '../../../common/validacion/fecha-sin-hora.js';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { Paginacion } from '../../../common/validacion/paginacion.js';
import { TextoBusqueda } from '../../../common/validacion/texto-busqueda.js';

const GRUPOS = Object.values(GRUPOS_MOVIMIENTO);

/** Filtros y paginación de los movimientos del panel (E11-H5 criterio 2, SCRUM-150). */
export class ListarMovimientosDto extends Paginacion {
  @ApiPropertyOptional({
    description:
      'Solo los movimientos con origen o destino en una ubicación de esta bodega.',
  })
  @Type(() => Number)
  @IdEntero({
    faltante: 'La bodega indicada no es válida.',
    invalido: 'La bodega indicada no es válida.',
    opcional: true,
  })
  bodegaId?: number;

  @ApiPropertyOptional({
    enum: GRUPOS,
    description:
      '«entradas»: entrada, ajuste positivo y reingreso; «salidas»: mermas, consumo y ajuste negativo. Sin él, todos.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsIn(GRUPOS, {
    message: `El grupo de movimientos debe ser uno de estos: ${GRUPOS.join(', ')}.`,
  })
  grupo?: (typeof GRUPOS)[number];

  @ApiPropertyOptional({
    example: '2026-11-01',
    format: 'date',
    description: 'Desde este día, en hora de Chile.',
  })
  @FechaSinHora({ etiqueta: 'La fecha desde', presencia: 'puedeFaltar' })
  desde?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    format: 'date',
    description: 'Hasta este día incluido, en hora de Chile.',
  })
  @FechaSinHora({ etiqueta: 'La fecha hasta', presencia: 'puedeFaltar' })
  hasta?: string;

  @ApiPropertyOptional({
    description:
      'Texto contenido en el producto, el formato o la referencia (documento, código del pedido u observación).',
    maxLength: 200,
  })
  @TextoBusqueda({ maximo: 200 })
  buscar?: string;
}
