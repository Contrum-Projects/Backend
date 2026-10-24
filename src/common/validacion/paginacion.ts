import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { NumeroPositivo } from './numero-positivo.js';

/** Elementos por página de un listado si no se indica `limite`. */
export const POR_PAGINA = 20;
/** Tope de `limite`: acota el costo de una página. */
export const MAXIMO_POR_PAGINA = 100;

/** Paginación de los listados (`?pagina=2&limite=20`). Los DTOs de listado la extienden. */
export class Paginacion {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @NumeroPositivo({ etiqueta: 'La página', presencia: 'puedeFaltar' })
  pagina?: number;

  @ApiPropertyOptional({
    default: POR_PAGINA,
    minimum: 1,
    maximum: MAXIMO_POR_PAGINA,
  })
  @Type(() => Number)
  @NumeroPositivo({
    etiqueta: 'El límite',
    maximo: MAXIMO_POR_PAGINA,
    presencia: 'puedeFaltar',
  })
  limite?: number;
}
