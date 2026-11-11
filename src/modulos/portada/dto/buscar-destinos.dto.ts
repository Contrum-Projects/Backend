import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TIPOS_DESTINO_PORTADA } from '../../../common/dominio/valores.js';
import type { TipoDestinoPortada } from '../destinos-portada.js';

const TIPOS = Object.values(TIPOS_DESTINO_PORTADA);

/** Filtro de `GET /portada/destinos` (SCRUM-157). */
export class BuscarDestinosDto {
  @ApiProperty({ enum: TIPOS })
  @IsIn(TIPOS, {
    message: `El tipo de destino debe ser uno de estos: ${TIPOS.join(', ')}.`,
  })
  tipo!: TipoDestinoPortada;

  @ApiPropertyOptional({ description: 'Parte del nombre.', example: 'repar' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString({ message: 'La búsqueda no es válida.' })
  @MaxLength(100, { message: 'La búsqueda puede tener hasta 100 caracteres.' })
  buscar?: string;
}
