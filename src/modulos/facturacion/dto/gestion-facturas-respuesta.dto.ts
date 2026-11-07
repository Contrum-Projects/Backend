import { ApiProperty } from '@nestjs/swagger';
import { ESTADOS_FACTURA_GESTION } from '../../../common/dominio/valores.js';

/** Respuestas de `/api/gestion/facturas` (E9-H3, SCRUM-150), declaradas para el Swagger. */

const ESTADOS = Object.values(ESTADOS_FACTURA_GESTION);

class FacturaGestionDto {
  @ApiProperty({ example: 'AB12CD34EF56' })
  codigoPedido: string;

  @ApiProperty({ example: 'Peluquería Bella Ltda.' })
  razonSocial: string;

  @ApiProperty({ example: '76123456-0' })
  rut: string;

  @ApiProperty({ example: 25990, description: 'Total con IVA, en pesos.' })
  total: number;

  @ApiProperty({ enum: ESTADOS })
  estado: (typeof ESTADOS)[number];

  @ApiProperty({
    type: Number,
    nullable: true,
    description: '`null` mientras está por emitir.',
  })
  folio: number | null;
}

export class ListadoFacturasGestionDto {
  @ApiProperty({ type: [FacturaGestionDto] })
  items: FacturaGestionDto[];

  @ApiProperty({ example: 3, description: 'Cuántas quedan por emitir.' })
  porEmitir: number;

  @ApiProperty({ example: 10 })
  total: number;

  @ApiProperty({ example: 1 })
  pagina: number;

  @ApiProperty({ example: 20 })
  limite: number;
}

class ReceptorFacturaDto {
  @ApiProperty()
  razonSocial: string;

  @ApiProperty({ example: '76123456-0' })
  rut: string;

  @ApiProperty()
  giro: string;

  @ApiProperty()
  direccion: string;

  @ApiProperty({ description: 'Nombre de la comuna.' })
  comuna: string;
}

class MontosFacturaDto {
  @ApiProperty({ example: 21840 })
  neto: number;

  @ApiProperty({ example: 4150 })
  iva: number;

  @ApiProperty({ example: 25990 })
  total: number;
}

export class DetalleFacturaGestionDto {
  @ApiProperty({ example: 'AB12CD34EF56' })
  codigoPedido: string;

  @ApiProperty({ enum: ESTADOS })
  estado: (typeof ESTADOS)[number];

  @ApiProperty({ type: ReceptorFacturaDto })
  receptor: ReceptorFacturaDto;

  @ApiProperty({ type: MontosFacturaDto })
  montos: MontosFacturaDto;

  @ApiProperty({ example: 19 })
  porcentajeIva: number;

  @ApiProperty({ type: Number, nullable: true })
  folio: number | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  fechaEmision: string | null;
}
