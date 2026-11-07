import { ApiProperty } from '@nestjs/swagger';

/** Respuesta de `GET /api/inventario/stock` (E11-H5, SCRUM-150), declarada para el Swagger. */

class UbicacionConStockDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'A-01' })
  codigo: string;
}

class ProveedorDeEntradaDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Distribuidora Capilar SpA' })
  razonSocial: string;
}

class UltimaEntradaListadoDto {
  @ApiProperty({ example: 4200.5, description: 'Costo unitario neto.' })
  costoUnitarioNeto: number;

  @ApiProperty({ type: ProveedorDeEntradaDto })
  proveedor: ProveedorDeEntradaDto;
}

export class StockListadoDto {
  @ApiProperty({ example: 21 })
  formatoId: number;

  @ApiProperty({ example: 'SH-REP-300' })
  sku: string;

  @ApiProperty({ example: 'Shampoo reparador' })
  producto: string;

  @ApiProperty({ example: '300 ml' })
  nombreFormato: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'URL de la foto principal del formato; `null` si no tiene.',
  })
  imagen: string | null;

  @ApiProperty({
    type: [UbicacionConStockDto],
    description:
      'Ubicaciones con unidades (de la bodega elegida, o de todas), por código.',
  })
  ubicaciones: UbicacionConStockDto[];

  @ApiProperty({
    example: 12,
    description: 'Unidades en la bodega elegida, o en todas.',
  })
  stock: number;

  @ApiProperty({ example: 5, description: '0: el formato no tiene mínimo.' })
  stockMinimo: number;

  @ApiProperty({
    description:
      'El stock total del formato (todas sus ubicaciones) está bajo su mínimo: la misma regla del aviso de E11-H6.',
  })
  bajoMinimo: boolean;

  @ApiProperty({
    type: UltimaEntradaListadoDto,
    nullable: true,
    description:
      'Costo y proveedor de la entrada más reciente; `null` si nunca se recibió.',
  })
  ultimaEntrada: UltimaEntradaListadoDto | null;
}

export class ListadoStockDto {
  @ApiProperty({ type: [StockListadoDto] })
  items: StockListadoDto[];

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  pagina: number;

  @ApiProperty({ example: 20 })
  limite: number;

  @ApiProperty({
    example: 2,
    description:
      'Formatos bajo el mínimo con la misma bodega y búsqueda (sin el filtro `bajoMinimo`).',
  })
  totalBajoMinimo: number;
}
