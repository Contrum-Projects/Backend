import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

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

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'LOREAL20',
    description:
      'Cupón que se aplicará (SCRUM-150): el total ya trae su descuento. Si no aplica, 400 junto a `codigoCupon`.',
  })
  @TextoOpcional({ etiqueta: 'El código del cupón', maximo: 40 })
  codigoCupon?: string | null;
}
