import { ApiProperty } from '@nestjs/swagger';

/** Respuesta de `GET /api/tienda/facetas` (E2-H2, SCRUM-150), declarada para el Swagger. */

class FacetaTiendaDto {
  @ApiProperty({ example: 3305 })
  id: number;

  @ApiProperty({
    example: 24,
    description: 'Productos con la búsqueda y los filtros.',
  })
  total: number;
}

export class FacetasTiendaDto {
  @ApiProperty({
    type: [FacetaTiendaDto],
    description:
      'Por categoría, con sus subcategorías; cuenta con la búsqueda y las marcas marcadas.',
  })
  categorias: FacetaTiendaDto[];

  @ApiProperty({
    type: [FacetaTiendaDto],
    description: 'Por marca; cuenta con la búsqueda y las categorías marcadas.',
  })
  marcas: FacetaTiendaDto[];
}
