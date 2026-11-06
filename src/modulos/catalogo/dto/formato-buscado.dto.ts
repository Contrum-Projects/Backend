import { ApiProperty } from '@nestjs/swagger';
import { CANALES_VENTA, type Valor } from '../../../common/dominio/valores.js';

/** Respuesta de `GET /api/catalogo/formatos` (SCRUM-150), declarada para el Swagger. */

class ProductoDelFormatoDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ example: 'Shampoo reparador' })
  nombre: string;
}

export class FormatoBuscadoDto {
  @ApiProperty({ example: 21 })
  formatoId: number;

  @ApiProperty({ example: 'SH-REP-300' })
  sku: string;

  @ApiProperty({ example: '300 ml' })
  nombreFormato: string;

  @ApiProperty({ type: ProductoDelFormatoDto })
  producto: ProductoDelFormatoDto;

  @ApiProperty({
    enum: Object.values(CANALES_VENTA),
    description:
      'Canal del producto: un pack general no admite formatos exclusivos.',
  })
  canalVenta: Valor<typeof CANALES_VENTA>;

  @ApiProperty({
    example: 2,
    description: 'Unidades en ubicaciones activas de bodegas activas.',
  })
  stockTotal: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 10916,
    description: 'Precio minorista neto; `null` si aún no tiene.',
  })
  precioMinoristaNeto: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 12990,
    description:
      'Precio minorista con IVA en pesos enteros, como en la tienda.',
  })
  precioMinoristaConIva: number | null;
}

export class ListadoFormatosBuscadosDto {
  @ApiProperty({ type: [FormatoBuscadoDto] })
  items: FormatoBuscadoDto[];

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  pagina: number;

  @ApiProperty({ example: 20 })
  limite: number;
}
