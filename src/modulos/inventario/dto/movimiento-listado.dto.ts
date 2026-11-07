import { ApiProperty } from '@nestjs/swagger';
import {
  TIPOS_MOVIMIENTO,
  type Valor,
} from '../../../common/dominio/valores.js';

/** Respuesta de `GET /api/inventario/movimientos` (E11-H5, SCRUM-150), declarada para el Swagger. */

class FormatoDelMovimientoDto {
  @ApiProperty({ example: 21 })
  id: number;

  @ApiProperty({ example: 'Shampoo reparador' })
  producto: string;

  @ApiProperty({ example: '300 ml' })
  nombreFormato: string;
}

export class UbicacionResumenDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'A-01' })
  codigo: string;

  @ApiProperty({
    example: 'Bodega principal',
    description: 'Nombre de la bodega.',
  })
  bodega: string;
}

class RegistradoPorDto {
  @ApiProperty({ example: 'Camila Rojas' })
  nombre: string;
}

export class MovimientoListadoDto {
  @ApiProperty({ example: 90 })
  id: number;

  @ApiProperty({ example: '2026-11-06T13:15:00.000Z', format: 'date-time' })
  fechaHora: string;

  @ApiProperty({ enum: Object.values(TIPOS_MOVIMIENTO) })
  tipo: Valor<typeof TIPOS_MOVIMIENTO>;

  @ApiProperty({ type: FormatoDelMovimientoDto })
  formato: FormatoDelMovimientoDto;

  @ApiProperty({
    example: -2,
    description:
      'Con signo: positiva si suma stock y negativa si lo resta; la transferencia, positiva.',
  })
  cantidad: number;

  @ApiProperty({
    type: UbicacionResumenDto,
    description:
      'La ubicación del movimiento; en la transferencia, la de origen.',
  })
  ubicacion: UbicacionResumenDto;

  @ApiProperty({
    type: UbicacionResumenDto,
    nullable: true,
    description: 'Solo en la transferencia: la ubicación de destino.',
  })
  destino: UbicacionResumenDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'F-1234',
    description:
      'N.º de documento de la entrada, código del pedido (venta y reingreso) u observación.',
  })
  referencia: string | null;

  @ApiProperty({
    type: RegistradoPorDto,
    nullable: true,
    description:
      '`null`: lo registró el sistema (ventas y reingresos de pedidos).',
  })
  registradoPor: RegistradoPorDto | null;
}

export class ListadoMovimientosDto {
  @ApiProperty({ type: [MovimientoListadoDto] })
  items: MovimientoListadoDto[];

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  pagina: number;

  @ApiProperty({ example: 20 })
  limite: number;
}
