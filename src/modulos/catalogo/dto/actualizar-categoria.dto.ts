import { ApiPropertyOptional } from '@nestjs/swagger';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

/**
 * Cambios sobre una categoría (E3-H4). Solo se modifica lo que llega en el cuerpo.
 * Mover la categoría es cambiar su `padreId`; con `null` pasa a ser categoría raíz. El nombre no
 * puede quedar vacío ni ser `null`; la descripción sí se borra con `null` o un texto vacío.
 */
export class ActualizarCategoriaDto {
  @ApiPropertyOptional({ example: 'Shampoos', maxLength: 100 })
  @TextoObligatorio({
    etiqueta: 'El nombre de la categoría',
    maximo: 100,
    puedeFaltar: true,
  })
  nombre?: string;

  @ApiPropertyOptional({
    example: 'Limpieza y cuidado del cuero cabelludo',
    maxLength: 255,
    nullable: true,
  })
  @TextoOpcional({ etiqueta: 'La descripción', maximo: 255 })
  descripcion?: string | null;

  @ApiPropertyOptional({
    example: 2,
    nullable: true,
    description:
      'Id de la nueva categoría padre. `null` la deja como categoría raíz. No puede ser ella misma ni una de sus subcategorías.',
  })
  @IdEntero({
    faltante: 'La categoría padre no es válida.',
    invalido: 'La categoría padre no es válida.',
    anulable: true,
  })
  padreId?: number | null;
}
