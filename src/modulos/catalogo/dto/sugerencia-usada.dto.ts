import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsObject, Matches, ValidateIf, ValidateNested } from 'class-validator';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { LARGO_MAXIMO_DESCRIPCION_IA } from '../cliente-ia.js';
import { FORMATO_FIRMA } from '../firma-sugerencia.js';

/**
 * La sugerencia de la IA de la que partió la descripción (E4-H2), tal como la devolvió
 * `POST /api/catalogo/descripciones/sugerencia`. Si no llega, la descripción es manual.
 */
export class SugerenciaUsadaDto {
  @ApiProperty({
    description: 'La descripción sugerida, sin cambios.',
    maxLength: LARGO_MAXIMO_DESCRIPCION_IA,
  })
  @TextoObligatorio({
    etiqueta: 'La descripción sugerida',
    maximo: LARGO_MAXIMO_DESCRIPCION_IA,
    femenino: true,
  })
  descripcion: string;

  @ApiProperty({ description: 'La firma que vino con la sugerencia.' })
  @Matches(FORMATO_FIRMA, {
    message: 'La firma de la sugerencia no es válida.',
  })
  firma: string;
}

const MENSAJE_SUGERENCIA_INCOMPLETA =
  'La sugerencia debe traer su descripción y su firma.';

/** Campo opcional `sugerencia` de crear y editar un producto (E4-H2). */
export const SugerenciaUsada = () =>
  applyDecorators(
    ApiPropertyOptional({
      type: SugerenciaUsadaDto,
      description:
        'Solo si la descripción partió de una sugerencia de la IA. Igual a la sugerida: origen «ia»; cambiada: «ia_editada». Sin este campo, al crear el origen es «manual».',
    }),
    ValidateIf((_objeto, valor) => valor !== undefined),
    IsObject({ message: MENSAJE_SUGERENCIA_INCOMPLETA }),
    ValidateNested({ message: MENSAJE_SUGERENCIA_INCOMPLETA }),
    Type(() => SugerenciaUsadaDto),
  );
