import { ApiProperty } from '@nestjs/swagger';
import { Correo } from '../../../common/validacion/correo.js';

/** Entrada de la suscripción a ofertas sin cuenta (E12-H1, RF-12.01). */
export class SuscribirseDto {
  @ApiProperty({
    example: 'camila@correo.cl',
    maxLength: 254,
    description: 'Se guarda recortado y en minúsculas.',
  })
  @Correo()
  email: string;
}
