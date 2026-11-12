import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';
import { CANALES_VENTA } from '../../../common/dominio/valores.js';
import { LARGO_MAXIMO_INGREDIENTES_IA } from '../cliente-ia.js';
import { CanalVenta } from './canal-venta.decorator.js';
import { SugerenciaUsada, SugerenciaUsadaDto } from './sugerencia-usada.dto.js';

/** Largo mínimo de la descripción del producto, ya recortada. */
export const MINIMO_DESCRIPCION_PRODUCTO = 50;

/**
 * Entrada para crear un producto (E3-H1, RF-03.01).
 * El producto nace activo. La descripción es manual salvo que llegue la `sugerencia` firmada de la
 * IA de la que partió (E4-H2): entonces su origen es «ia» o «ia_editada».
 *
 * Cada dato obligatorio tiene su mensaje en español que nombra el campo, para que el panel
 * pueda señalar lo que falta (criterio «datos obligatorios faltantes»).
 */
export class CrearProductoDto {
  @ApiProperty({ example: 'Shampoo reparador', maxLength: 200 })
  @TextoObligatorio({ etiqueta: 'El nombre del producto', maximo: 200 })
  nombre: string;

  @ApiProperty({
    example:
      'Repara el cabello dañado por procesos químicos y le devuelve su brillo natural.',
    minLength: MINIMO_DESCRIPCION_PRODUCTO,
    maxLength: 5000,
  })
  @TextoObligatorio({
    etiqueta: 'La descripción del producto',
    maximo: 5000,
    minimo: MINIMO_DESCRIPCION_PRODUCTO,
    femenino: true,
  })
  descripcion: string;

  @SugerenciaUsada()
  sugerencia?: SugerenciaUsadaDto;

  @ApiPropertyOptional({
    example: 'Aqua, Sodium Laureth Sulfate, Glycerin',
    maxLength: LARGO_MAXIMO_INGREDIENTES_IA,
    nullable: true,
    description: 'Lista de ingredientes del reverso (E4-H2). Opcional.',
  })
  @TextoOpcional({
    etiqueta: 'La lista de ingredientes',
    maximo: LARGO_MAXIMO_INGREDIENTES_IA,
  })
  ingredientes?: string | null;

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
