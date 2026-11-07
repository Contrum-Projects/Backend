import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { GRUPOS_PEDIDOS_GESTION } from '../../../common/dominio/valores.js';
import { Paginacion } from '../../../common/validacion/paginacion.js';
import { TextoBusqueda } from '../../../common/validacion/texto-busqueda.js';

const CLAVES = GRUPOS_PEDIDOS_GESTION.map((grupo) => grupo.clave);

/** Filtro, búsqueda y paginación de la lista de pedidos del panel (E8-H2, SCRUM-150). */
export class ListarPedidosGestionDto extends Paginacion {
  @ApiPropertyOptional({
    enum: CLAVES,
    description: 'Grupo del filtro; sin él, `por_preparar`.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsIn(CLAVES, {
    message: `El grupo debe ser uno de estos: ${CLAVES.join(', ')}.`,
  })
  grupo?: (typeof CLAVES)[number];

  @ApiPropertyOptional({
    description:
      'Texto contenido en el código del pedido, el nombre, apellido o correo del cliente, la razón social de su factura o el nombre de un producto o pack del pedido.',
    maxLength: 100,
  })
  @TextoBusqueda({ maximo: 100 })
  q?: string;
}
