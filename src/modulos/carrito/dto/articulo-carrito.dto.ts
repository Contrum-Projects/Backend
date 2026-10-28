import { ApiProperty } from '@nestjs/swagger';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { NumeroPositivo } from '../../../common/validacion/numero-positivo.js';

/**
 * Tope técnico de unidades de un artículo en el carrito: evita cantidades absurdas antes de
 * consultar la base. El límite real es el stock disponible, que se revisa aparte.
 */
export const MAXIMO_UNIDADES_LINEA = 999;

/** Un artículo que se agrega al carrito (E5-H1, RF-05.01). */
export class AgregarArticuloCarritoDto {
  @ApiProperty({
    example: 11,
    description:
      'Id del artículo: el de un formato de producto o el de un pack.',
  })
  @IdEntero({
    faltante: 'Indica el artículo que quieres agregar.',
    invalido: 'El artículo indicado no es válido.',
  })
  articuloId: number;

  @ApiProperty({
    example: 2,
    minimum: 1,
    maximum: MAXIMO_UNIDADES_LINEA,
    description:
      'Unidades que se suman a las que el carrito ya tiene de ese artículo.',
  })
  @NumeroPositivo({
    etiqueta: 'La cantidad',
    femenino: true,
    maximo: MAXIMO_UNIDADES_LINEA,
  })
  cantidad: number;
}

/** La cantidad nueva de un artículo que ya está en el carrito (E5-H1, RF-05.03). */
export class CambiarCantidadCarritoDto {
  @ApiProperty({
    example: 3,
    minimum: 1,
    maximum: MAXIMO_UNIDADES_LINEA,
    description:
      'Cantidad final del artículo en el carrito. Para quitarlo se usa DELETE.',
  })
  @NumeroPositivo({
    etiqueta: 'La cantidad',
    femenino: true,
    maximo: MAXIMO_UNIDADES_LINEA,
  })
  cantidad: number;
}
