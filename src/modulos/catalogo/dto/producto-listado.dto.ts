import { ApiProperty } from '@nestjs/swagger';
import {
  CANALES_VENTA,
  ORIGENES_DESCRIPCION,
} from '../../../common/dominio/valores.js';

/** Respuesta de `GET /api/catalogo/productos` (E3-H1, SCRUM-150), declarada para el Swagger. */

class ReferenciaNombreDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: 'Kerastase' })
  nombre: string;
}

export class ProductoListadoPanelDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ type: Number, nullable: true, example: 2 })
  marcaId: number | null;

  @ApiProperty({ example: 3 })
  categoriaId: number;

  @ApiProperty({ example: 'Shampoo reparador' })
  nombre: string;

  @ApiProperty()
  descripcion: string;

  @ApiProperty({ enum: Object.values(ORIGENES_DESCRIPCION) })
  origenDescripcion: (typeof ORIGENES_DESCRIPCION)[keyof typeof ORIGENES_DESCRIPCION];

  @ApiProperty({ type: String, nullable: true })
  ingredientes: string | null;

  @ApiProperty({ enum: Object.values(CANALES_VENTA) })
  canalVenta: (typeof CANALES_VENTA)[keyof typeof CANALES_VENTA];

  @ApiProperty()
  activo: boolean;

  @ApiProperty({ format: 'date-time' })
  fechaCreacion: string;

  @ApiProperty({ type: ReferenciaNombreDto, nullable: true })
  marca: ReferenciaNombreDto | null;

  @ApiProperty({ type: ReferenciaNombreDto })
  categoria: ReferenciaNombreDto;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'URL de la foto principal del formato predeterminado, o `null`.',
  })
  imagen: string | null;

  @ApiProperty({ example: 2, description: 'Formatos activos.' })
  formatos: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 12990,
    description:
      'Menor precio con IVA, en pesos enteros, entre sus formatos activos y del canal del producto (minorista si es general, mayorista si es exclusivo); `null` sin precios.',
  })
  precioDesde: number | null;

  @ApiProperty({
    example: 24,
    description:
      'Unidades en ubicaciones activas de bodegas activas, sumando sus formatos.',
  })
  stockTotal: number;

  @ApiProperty({
    description:
      'Algún formato está bajo su stock mínimo (regla del aviso de E11-H6: stock total en todas sus ubicaciones).',
  })
  stockBajo: boolean;
}

class ConteosProductosPanelDto {
  @ApiProperty({ example: 86, description: 'Con los inactivos.' })
  todos: number;

  @ApiProperty({ example: 12 })
  exclusivos: number;

  @ApiProperty({ example: 4 })
  stockBajo: number;

  @ApiProperty({ example: 3 })
  inactivos: number;
}

export class ListadoProductosPanelDto {
  @ApiProperty({ type: [ProductoListadoPanelDto] })
  items: ProductoListadoPanelDto[];

  @ApiProperty({ example: 86 })
  total: number;

  @ApiProperty({ example: 1 })
  pagina: number;

  @ApiProperty({ example: 20 })
  limite: number;

  @ApiProperty({
    type: ConteosProductosPanelDto,
    description:
      'Productos de cada chip con la búsqueda, la categoría y la marca aplicadas.',
  })
  conteos: ConteosProductosPanelDto;
}
