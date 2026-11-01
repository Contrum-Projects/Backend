import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IdEntero } from '../../../common/validacion/id-entero.js';

/** A qué dirección de la cuenta se cotiza el despacho del carrito (E7-H2). */
export class CotizarDespachoDto {
  @ApiProperty({
    example: 12,
    description: 'Id de una dirección de la cuenta.',
  })
  @Type(() => Number)
  @IdEntero({
    faltante: 'La dirección es obligatoria para cotizar el despacho.',
    invalido: 'La dirección indicada no es válida.',
  })
  direccionId: number;
}
