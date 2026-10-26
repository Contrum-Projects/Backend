import { ApiProperty } from '@nestjs/swagger';
import {
  ContrasenaIngresada,
  ContrasenaNueva,
} from '../../../common/validacion/contrasena.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { MAXIMO_TOKEN_ENLACE } from './confirmar-correo.dto.js';

/**
 * Entrada del cambio de contraseña con el enlace de recuperación (E1-H4, RF-01.06): mismas
 * reglas de contraseña que el registro (E1-H1).
 */
export class RestablecerContrasenaDto {
  @ApiProperty({ description: 'Token recibido en el enlace de recuperación.' })
  @TextoObligatorio({
    etiqueta: 'El token del enlace',
    maximo: MAXIMO_TOKEN_ENLACE,
  })
  token: string;

  @ApiProperty({
    description: 'Mínimo 8 caracteres, con al menos una letra y un número.',
    minLength: 8,
    maxLength: 128,
  })
  @ContrasenaNueva()
  contrasena: string;

  @ApiProperty({ description: 'Debe ser igual a la contraseña.' })
  @ContrasenaIngresada({ etiqueta: 'La confirmación de la contraseña' })
  confirmacionContrasena: string;
}
