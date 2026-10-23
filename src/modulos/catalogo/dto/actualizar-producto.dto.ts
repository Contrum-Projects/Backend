import { ApiPropertyOptional } from '@nestjs/swagger';
import { CanalVenta } from './canal-venta.decorator.js';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { CANALES_VENTA } from '../../../common/dominio/valores.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';

/**
 * Cambios sobre un producto (E3-H1). Solo se modifica lo que llega en el cuerpo; lo que
 * llega no puede quedar vacío ni `null`.
 * Desactivar no va aquí: tiene su propia ruta.
 */
export class ActualizarProductoDto {
  @ApiPropertyOptional({ example: 'Shampoo reparador', maxLength: 200 })
  @TextoObligatorio({
    etiqueta: 'El nombre del producto',
    maximo: 200,
    puedeFaltar: true,
  })
  nombre?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @TextoObligatorio({
    etiqueta: 'La descripción del producto',
    maximo: 5000,
    femenino: true,
    puedeFaltar: true,
  })
  descripcion?: string;

  @ApiPropertyOptional({ example: 2 })
  @IdEntero({
    faltante: 'La categoría del producto no puede quedar vacía.',
    invalido: 'La categoría indicada no es válida.',
    opcional: true,
  })
  categoriaId?: number;

  @ApiPropertyOptional({
    example: 1,
    description:
      'Id de una marca activa. La marca es obligatoria: se puede cambiar, no quitar.',
  })
  @IdEntero({
    faltante: 'La marca del producto no puede quedar vacía.',
    invalido: 'La marca indicada no es válida.',
    opcional: true,
  })
  marcaId?: number;

  @ApiPropertyOptional({
    enum: Object.values(CANALES_VENTA),
    example: CANALES_VENTA.GENERAL,
  })
  @CanalVenta({ puedeFaltar: true })
  canalVenta?: string;
}
