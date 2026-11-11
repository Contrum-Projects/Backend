import { ApiProperty } from '@nestjs/swagger';
import {
  PAGINAS_PORTADA,
  TIPOS_DESTINO_PORTADA,
} from '../../../common/dominio/valores.js';
import type { TipoDestinoPortada } from '../destinos-portada.js';

/** Respuestas de `/api/portada` (SCRUM-157), declaradas para que el frontend genere sus tipos. */

export class DestinoSlideDto {
  @ApiProperty({ enum: Object.values(TIPOS_DESTINO_PORTADA) })
  tipo: TipoDestinoPortada;

  @ApiProperty({
    example: '12',
    description: `Id del producto, pack, categoría o marca; con \`tipo\` = \`pagina\`, una de: ${Object.values(PAGINAS_PORTADA).join(', ')}.`,
  })
  destino: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Pack reparación',
    description:
      'Nombre del destino, para anunciar el enlace. En la tienda siempre viene; en el panel es `null` si el destino ya no existe.',
  })
  nombre: string | null;
}

/** Slide tal como lo muestra la tienda. */
export class SlidePortadaDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({
    example: 'https://imagenes.cabelloperfecto.cl/portada/a1.webp',
  })
  imagenEscritorio: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Sin ella, el celular muestra la de escritorio.',
  })
  imagenCelular: string | null;

  @ApiProperty({ type: DestinoSlideDto })
  destino: DestinoSlideDto;
}

/** Slide en el panel: además, su orden y si la tienda lo muestra. */
export class SlidePortadaPanelDto extends SlidePortadaDto {
  @ApiProperty({ example: 1 })
  orden: number;

  @ApiProperty({
    description:
      'Falso si el destino ya no está a la venta o no existe: la tienda no muestra el slide.',
  })
  disponible: boolean;
}

/** Una opción para elegir el destino. */
export class OpcionDestinoDto {
  @ApiProperty({ example: '12' })
  destino: string;

  @ApiProperty({ example: 'Pack reparación' })
  nombre: string;
}
