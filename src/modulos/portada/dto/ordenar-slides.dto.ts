import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
} from 'class-validator';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { MAXIMO_SLIDES_PORTADA } from '../portada.service.js';

/** Nuevo orden de los slides de la portada (SCRUM-157). */
export class OrdenarSlidesDto {
  @ApiProperty({
    description:
      'Ids de todos los slides, cada uno una vez, en el orden en que se mostrarán.',
    type: [Number],
    example: [3, 1, 2],
  })
  @IsArray({ message: 'Indica el orden de las imágenes.' })
  @ArrayMinSize(1, { message: 'Indica el orden de las imágenes.' })
  @ArrayMaxSize(MAXIMO_SLIDES_PORTADA, {
    message: `La portada tiene hasta ${MAXIMO_SLIDES_PORTADA} imágenes.`,
  })
  @ArrayUnique({ message: 'Cada imagen debe aparecer una sola vez.' })
  @IdEntero({
    faltante: 'Indica el orden de las imágenes.',
    invalido: 'Alguna imagen indicada no es válida.',
    each: true,
  })
  orden!: number[];
}
