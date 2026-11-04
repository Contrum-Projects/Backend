import { ApiProperty } from '@nestjs/swagger';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { MAXIMO_TOKEN_SUSCRIPCION } from '../firma-suscripcion.js';

/** Entrada de la confirmación de la suscripción (E12-H1, RF-12.01). */
export class ConfirmarSuscripcionDto {
  @ApiProperty({
    description: 'Token firmado que llegó en el enlace del correo.',
  })
  @TextoObligatorio({
    etiqueta: 'El token del enlace',
    maximo: MAXIMO_TOKEN_SUSCRIPCION,
  })
  token: string;
}
