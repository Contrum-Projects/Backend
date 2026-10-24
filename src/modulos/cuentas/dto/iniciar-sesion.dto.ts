import { ApiProperty } from '@nestjs/swagger';
import { ContrasenaIngresada } from '../../../common/validacion/contrasena.js';
import { Correo } from '../../../common/validacion/correo.js';

/** Entrada del inicio de sesión (E1-H2, RF-01.03). */
export class IniciarSesionDto {
  @ApiProperty({ example: 'camila@correo.cl', maxLength: 254 })
  @Correo()
  email: string;

  @ApiProperty({ maxLength: 128 })
  @ContrasenaIngresada()
  contrasena: string;
}
