import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, ValidateIf } from 'class-validator';
import { ORIGENES_ERROR } from '../../../common/dominio/valores.js';
import { FechaSinHora } from '../../../common/validacion/fecha-sin-hora.js';
import { Paginacion } from '../../../common/validacion/paginacion.js';
import { TextoBusqueda } from '../../../common/validacion/texto-busqueda.js';
import type { OrigenError } from '../registro-errores.service.js';

const ORIGENES = Object.values(ORIGENES_ERROR);

/** Largo máximo de la búsqueda: un código completo (64) o parte de un mensaje. */
export const MAXIMO_BUSQUEDA_ERRORES = 100;

/** Filtros y paginación del registro de errores del panel (SCRUM-168). */
export class ListarRegistroErroresDto extends Paginacion {
  @ApiPropertyOptional({
    enum: ORIGENES,
    description: 'Solo los errores de este origen.',
  })
  @ValidateIf((_objeto, valor) => valor !== undefined)
  @IsIn(ORIGENES, {
    message: `El origen debe ser uno de estos: ${ORIGENES.join(', ')}.`,
  })
  origen?: OrigenError;

  @ApiPropertyOptional({
    description:
      'El comienzo del código de seguimiento (el que ve la persona, p. ej. `3F1C2B9E`), o un texto contenido en el componente o el mensaje. Sin distinguir mayúsculas.',
    maxLength: MAXIMO_BUSQUEDA_ERRORES,
  })
  @TextoBusqueda({ maximo: MAXIMO_BUSQUEDA_ERRORES, maximoPalabras: 1 })
  buscar?: string;

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
}
