import { ApiPropertyOptional } from '@nestjs/swagger';
import { Paginacion } from '../../../common/validacion/paginacion.js';
import { TextoBusqueda } from '../../../common/validacion/texto-busqueda.js';

/** Búsqueda de formatos del panel (E3-H6 criterio 2 y registro de inventario, SCRUM-150). */
export class ListarFormatosDto extends Paginacion {
  @ApiPropertyOptional({
    description:
      'Texto contenido en el nombre del producto, el del formato o el SKU, sin distinguir mayúsculas.',
    maxLength: 200,
  })
  @TextoBusqueda({ maximo: 200 })
  buscar?: string;
}
