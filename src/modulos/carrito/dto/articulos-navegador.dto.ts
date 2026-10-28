import { ApiProperty } from '@nestjs/swagger';
import { plainToInstance, Transform } from 'class-transformer';
import {
  ValidateBy,
  ValidateNested,
  type ValidationArguments,
} from 'class-validator';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { NumeroPositivo } from '../../../common/validacion/numero-positivo.js';
import { MAXIMO_UNIDADES_LINEA } from './articulo-carrito.dto.js';

/** Artículos distintos que caben en una petición del carrito del navegador (E5-H2). */
export const MAXIMO_ARTICULOS_NAVEGADOR = 50;

/** Un artículo del carrito que el visitante guarda en su navegador (E5-H2). */
export class ArticuloNavegadorDto {
  @ApiProperty({
    example: 11,
    description:
      'Id del artículo: el de un formato de producto o el de un pack.',
  })
  @IdEntero({
    faltante: 'Indica el id de cada artículo del carrito.',
    invalido: 'Algún artículo indicado no es válido.',
  })
  articuloId: number;

  @ApiProperty({ example: 2, minimum: 1, maximum: MAXIMO_UNIDADES_LINEA })
  @NumeroPositivo({
    etiqueta: 'La cantidad de cada artículo',
    femenino: true,
    maximo: MAXIMO_UNIDADES_LINEA,
  })
  cantidad: number;
}

const repiteArticulo = (lista: ArticuloNavegadorDto[]) => {
  const ids = lista
    .map((articulo) => articulo.articuloId)
    .filter((id) => id !== undefined);
  return new Set(ids).size !== ids.length;
};

const comoArticulo = (linea: unknown) =>
  plainToInstance(
    ArticuloNavegadorDto,
    typeof linea === 'object' && linea !== null ? linea : {},
  );

/**
 * El carrito del navegador (E5-H2, RF-05.02): de 1 a `MAXIMO_ARTICULOS_NAVEGADOR` artículos, cada
 * uno una sola vez. Lo que no es lista queda como lista vacía, así cada caso da un solo mensaje
 * en español. Que cada artículo se venda lo revisa el servicio contra la base.
 */
export class ArticulosNavegadorDto {
  @ApiProperty({
    type: [ArticuloNavegadorDto],
    minItems: 1,
    maxItems: MAXIMO_ARTICULOS_NAVEGADOR,
    description:
      'Artículos del carrito del navegador, cada uno una sola vez con su cantidad.',
  })
  // De una lista sobre el máximo basta un elemento de más para rechazarla: no se transforma ni
  // se valida el resto
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.slice(0, MAXIMO_ARTICULOS_NAVEGADOR + 1).map(comoArticulo)
      : [],
  )
  @ValidateBy({
    name: 'articulosNavegador',
    validator: {
      validate: (valor: unknown) =>
        Array.isArray(valor) &&
        valor.length > 0 &&
        valor.length <= MAXIMO_ARTICULOS_NAVEGADOR &&
        !repiteArticulo(valor as ArticuloNavegadorDto[]),
      defaultMessage: (argumentos?: ValidationArguments) => {
        const value: unknown = argumentos?.value;
        if (!Array.isArray(value) || value.length === 0) {
          return 'Indica los artículos del carrito.';
        }
        return value.length > MAXIMO_ARTICULOS_NAVEGADOR
          ? `El carrito tiene hasta ${MAXIMO_ARTICULOS_NAVEGADOR} artículos distintos.`
          : 'Cada artículo debe aparecer una sola vez: indica su cantidad.';
      },
    },
  })
  @ValidateNested({ each: true, message: 'Indica los artículos del carrito.' })
  articulos: ArticuloNavegadorDto[];
}
