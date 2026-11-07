import { ApiProperty } from '@nestjs/swagger';
import {
  ALCANCES_CUPON,
  TIPOS_DESCUENTO_CUPON,
} from '../../../common/dominio/valores.js';

class ElegidoCuponDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: "L'Oréal" })
  nombre: string;
}

class CampanaCuponDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Novedades para tu salón' })
  asunto: string;

  @ApiProperty({ description: 'Si ya se envió.' })
  enviada: boolean;
}

/** Un cupón en el panel (SCRUM-150), con sus usos y lo descontado. */
export class CuponPanelDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'LOREAL20' })
  codigo: string;

  @ApiProperty({ type: String, nullable: true })
  descripcion: string | null;

  @ApiProperty({ enum: Object.values(TIPOS_DESCUENTO_CUPON) })
  tipoDescuento: (typeof TIPOS_DESCUENTO_CUPON)[keyof typeof TIPOS_DESCUENTO_CUPON];

  @ApiProperty({ example: 20 })
  valor: number;

  @ApiProperty({ type: Number, nullable: true })
  topeDescuento: number | null;

  @ApiProperty({ enum: Object.values(ALCANCES_CUPON) })
  alcance: (typeof ALCANCES_CUPON)[keyof typeof ALCANCES_CUPON];

  @ApiProperty({
    type: [ElegidoCuponDto],
    description: 'Formatos y packs, con su nombre.',
  })
  articulos: ElegidoCuponDto[];

  @ApiProperty({ type: [ElegidoCuponDto] })
  categorias: ElegidoCuponDto[];

  @ApiProperty({ type: [ElegidoCuponDto] })
  marcas: ElegidoCuponDto[];

  @ApiProperty({ type: Number, nullable: true })
  compraMinima: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  fechaInicio: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  fechaFin: Date | null;

  @ApiProperty({ type: Number, nullable: true })
  usosMaximos: number | null;

  @ApiProperty({ type: Number, nullable: true })
  usosPorCuenta: number | null;

  @ApiProperty()
  incluyeProfesionales: boolean;

  @ApiProperty()
  activo: boolean;

  @ApiProperty({ type: CampanaCuponDto, nullable: true })
  campana: CampanaCuponDto | null;

  @ApiProperty({
    example: 18,
    description: 'Pedidos no cancelados que lo usaron.',
  })
  usos: number;

  @ApiProperty({
    example: 54000,
    description: 'Total descontado en esos pedidos, en pesos con IVA.',
  })
  descontado: number;

  @ApiProperty({ type: String, format: 'date-time' })
  fechaCreacion: Date;
}

/** Lo que descuenta un cupón sobre el carrito de la cuenta, antes de crear el pedido. */
export class CuponCarritoDto {
  @ApiProperty({ example: 'LOREAL20' })
  codigo: string;

  @ApiProperty({ type: String, nullable: true })
  descripcion: string | null;

  @ApiProperty({ example: 4000, description: 'En pesos con IVA.' })
  descuento: number;
}
