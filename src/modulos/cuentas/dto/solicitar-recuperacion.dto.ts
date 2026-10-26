import { ApiProperty } from '@nestjs/swagger';
import { Correo } from '../../../common/validacion/correo.js';

/** Entrada de la solicitud de recuperación de la contraseña (E1-H4, RF-01.06). */
export class SolicitarRecuperacionDto {
  @ApiProperty({ example: 'camila@correo.cl', maxLength: 254 })
  @Correo()
  email: string;
}
