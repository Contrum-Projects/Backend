import { ApiProperty } from '@nestjs/swagger';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { MAXIMO_TOKEN_BAJA } from '../firma-baja.js';

/** Entrada de la baja desde un correo publicitario (E12-H2, RF-12.03). */
export class DarDeBajaDto {
  @ApiProperty({
    description: 'Token firmado que llegó en el enlace de baja del correo.',
  })
  @TextoObligatorio({
    etiqueta: 'El token del enlace',
    maximo: MAXIMO_TOKEN_BAJA,
  })
  token: string;
}
