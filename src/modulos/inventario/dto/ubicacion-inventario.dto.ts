import { ApiProperty } from '@nestjs/swagger';

/** Respuesta de `GET /api/inventario/ubicaciones` (SCRUM-150), declarada para el Swagger. */

class BodegaDeUbicacionDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Bodega principal' })
  nombre: string;
}

export class UbicacionInventarioDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'A-01' })
  codigo: string;

  @ApiProperty({ type: BodegaDeUbicacionDto })
  bodega: BodegaDeUbicacionDto;
}
