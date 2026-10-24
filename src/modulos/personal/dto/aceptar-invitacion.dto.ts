import { ApiProperty } from '@nestjs/swagger';
import {
  ContrasenaIngresada,
  ContrasenaNueva,
} from '../../../common/validacion/contrasena.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { MAXIMO_TOKEN_ENLACE } from '../../cuentas/dto/confirmar-correo.dto.js';

/**
 * Entrada de la aceptación de la invitación (E13-H1): el personal define su
 * contraseña con las mismas reglas que el registro (E1-H1).
 */
export class AceptarInvitacionDto {
  @ApiProperty({ description: 'Token recibido en el enlace de la invitación.' })
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
