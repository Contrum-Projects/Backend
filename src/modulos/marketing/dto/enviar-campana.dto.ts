import { ApiProperty } from '@nestjs/swagger';
import { ValidateBy } from 'class-validator';
import { FORMATO_HUELLA } from '../huella-campana.js';

/** Confirmación del envío de una campaña (E12-H3, RF-12.07). */
export class EnviarCampanaDto {
  @ApiProperty({
    example: '1793920312.q3Zr0cU9mJ1kHk2b8vY6xW4tS7nP5aL0eD3fG2hJ1kM',
    description:
      'El valor `confirmacion` de una vista previa de la última hora. Si la campaña cambió después o pasó la hora, hay que pedir otra.',
  })
  @ValidateBy({
    name: 'confirmacionCampana',
    validator: {
      validate: (valor: unknown) =>
        typeof valor === 'string' && FORMATO_HUELLA.test(valor),
      defaultMessage: () =>
        'Pide la vista previa de la campaña antes de enviarla.',
    },
  })
  confirmacion: string;
}
