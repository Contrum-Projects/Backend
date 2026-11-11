import { ApiProperty } from '@nestjs/swagger';
import { Correo } from '../../../common/validacion/correo.js';

/**
 * Dirección que el administrador da de baja de la publicidad cuando la persona lo pide por correo
 * (E12-H2, decisión del equipo del 11 de noviembre de 2026).
 */
export class DarDeBajaDto {
  @ApiProperty({ example: 'camila@correo.cl', maxLength: 254 })
  @Correo()
  email: string;
}
