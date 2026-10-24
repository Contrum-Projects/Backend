import { ApiProperty } from '@nestjs/swagger';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';

/** Largo máximo del token de un enlace de correo (32 bytes en base64url son 43). */
export const MAXIMO_TOKEN_ENLACE = 128;

/** Entrada de la confirmación del correo (E1-H1, RF-01.02). */
export class ConfirmarCorreoDto {
  @ApiProperty({ description: 'Token recibido en el enlace del correo.' })
  @TextoObligatorio({
    etiqueta: 'El token del enlace',
    maximo: MAXIMO_TOKEN_ENLACE,
  })
  token: string;
}
