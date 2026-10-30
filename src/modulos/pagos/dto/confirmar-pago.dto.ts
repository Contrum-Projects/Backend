import { ApiProperty } from '@nestjs/swagger';
import { ValidateBy } from 'class-validator';

/** Ids de pago de Mercado Pago: solo dígitos. Acota el valor antes de consultarlo. */
const FORMATO_ID_PAGO = /^\d{1,20}$/;

/** Regreso desde Mercado Pago con el pago que hizo el comprador (E6-H1). */
export class ConfirmarPagoDto {
  @ApiProperty({
    example: '1234567890',
    description:
      'Id del pago que Mercado Pago entrega al volver a la tienda (`payment_id`).',
  })
  @ValidateBy({
    name: 'idPago',
    validator: {
      validate: (valor: unknown) =>
        typeof valor === 'string' && FORMATO_ID_PAGO.test(valor),
      defaultMessage: () => 'El pago indicado no es válido.',
    },
  })
  pagoId!: string;
}
