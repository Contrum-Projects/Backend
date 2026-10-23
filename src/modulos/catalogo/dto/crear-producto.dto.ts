import { ApiProperty } from '@nestjs/swagger';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { CANALES_VENTA } from '../../../common/dominio/valores.js';
import { CanalVenta } from './canal-venta.decorator.js';

/**
 * Entrada para crear un producto (E3-H1, RF-03.01).
 * El producto nace activo y con la descripción escrita a mano (`origenDescripcion = manual`);
 * la descripción sugerida por IA llega con la épica 4.
 *
 * Cada dato obligatorio tiene su mensaje en español que nombra el campo, para que el panel
 * pueda señalar lo que falta (criterio «datos obligatorios faltantes»).
 */
export class CrearProductoDto {
  @ApiProperty({ example: 'Shampoo reparador', maxLength: 200 })
  @TextoObligatorio({ etiqueta: 'El nombre del producto', maximo: 200 })
  nombre: string;

  @ApiProperty({
    example: 'Repara el cabello dañado por procesos químicos.',
    maxLength: 5000,
  })
  @TextoObligatorio({
    etiqueta: 'La descripción del producto',
    maximo: 5000,
    femenino: true,
  })
  descripcion: string;

  @ApiProperty({
    example: 1,
    description: 'Id de la categoría o subcategoría del producto.',
  })
  @IdEntero({
    faltante: 'La categoría del producto es obligatoria.',
    invalido: 'La categoría indicada no es válida.',
  })
  categoriaId: number;

  @ApiProperty({
    example: 1,
    description:
      'Id de una marca activa de la lista de marcas. Es obligatoria.',
  })
  @IdEntero({
    faltante: 'La marca del producto es obligatoria.',
    invalido: 'La marca indicada no es válida.',
  })
  marcaId: number;

  @ApiProperty({
    enum: Object.values(CANALES_VENTA),
    example: CANALES_VENTA.GENERAL,
    description: 'Canal de venta del producto: general o profesional.',
  })
  @CanalVenta()
  canalVenta: string;
}
