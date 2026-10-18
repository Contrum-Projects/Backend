import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Entrada de la aceptación de la invitación (E13-H1): el personal define su
 * contraseña con las mismas reglas que el registro (E1-H1).
 */
export class AceptarInvitacionDto {
  @ApiProperty({ description: 'Token recibido en el enlace de la invitación.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token: string;

  @ApiProperty({
    description: 'Mínimo 8 caracteres, con al menos una letra y un número.',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(128)
  @Matches(/\p{L}/u, {
    message: 'La contraseña debe tener al menos una letra.',
  })
  @Matches(/\d/, { message: 'La contraseña debe tener al menos un número.' })
  contrasena: string;

  @ApiProperty({ description: 'Debe ser igual a la contraseña.' })
  @IsString()
  confirmacionContrasena: string;
}
