import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
} from 'class-validator';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { MAXIMO_IMAGENES_ARTICULO } from '../imagenes.service.js';

/** Nuevo orden de las imágenes de un artículo y cuál es la principal (E3-H3). */
export class OrdenarImagenesDto {
  @ApiProperty({
    description:
      'Ids de todas las imágenes del artículo, cada una una vez, en el orden en que se mostrarán.',
    type: [Number],
    example: [42, 40, 41],
  })
  @IsArray({ message: 'Indica el orden de las imágenes.' })
  @ArrayMinSize(1, { message: 'Indica el orden de las imágenes.' })
  @ArrayMaxSize(MAXIMO_IMAGENES_ARTICULO, {
    message: `Un artículo tiene hasta ${MAXIMO_IMAGENES_ARTICULO} imágenes.`,
  })
  @ArrayUnique({ message: 'Cada imagen debe aparecer una sola vez.' })
  @IdEntero({
    faltante: 'Indica el orden de las imágenes.',
    invalido: 'Alguna imagen indicada no es válida.',
    each: true,
  })
  orden!: number[];

  @ApiProperty({
    description: 'Id de la imagen que queda como principal.',
    example: 42,
  })
  @IdEntero({
    faltante: 'Indica la imagen principal.',
    invalido: 'La imagen principal indicada no es válida.',
  })
  principalId!: number;
}
