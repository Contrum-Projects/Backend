import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { TIPOS_DESTINO_PORTADA } from '../../../common/dominio/valores.js';
import type { TipoDestinoPortada } from '../destinos-portada.js';

const TIPOS = Object.values(TIPOS_DESTINO_PORTADA);

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A dónde lleva un slide (SCRUM-157). Llega como campos de texto, también dentro de un
 * `multipart/form-data`. El servicio comprueba que el destino exista y esté a la venta.
 */
export class DestinoPortadaDto {
  @ApiProperty({ enum: TIPOS, example: TIPOS_DESTINO_PORTADA.PACK })
  @Transform(recortar)
  @IsIn(TIPOS, {
    message: ({ value }) =>
      value === undefined || value === null || value === ''
        ? 'Elige a dónde lleva la imagen.'
        : `El tipo de destino debe ser uno de estos: ${TIPOS.join(', ')}.`,
  })
  tipoDestino!: TipoDestinoPortada;

  @ApiProperty({
    description:
      'Id del producto, pack, categoría o marca; o la clave de la página (`catalogo`, `packs`, `precio-profesional`). Las opciones salen de `GET /portada/destinos`.',
    example: '12',
  })
  @Transform(recortar)
  @IsString({ message: 'Elige a dónde lleva la imagen.' })
  @MaxLength(40, { message: 'El destino elegido no es válido.' })
  destino!: string;
}
