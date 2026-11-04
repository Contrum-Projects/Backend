import { ApiProperty } from '@nestjs/swagger';
import { Booleano } from '../../../common/validacion/booleano.js';

/** Elegir si la cuenta recibe publicidad (E12-H2, RF-12.02). */
export class ActualizarConsentimientoDto {
  @ApiProperty({ example: true, description: 'Recibir ofertas por correo.' })
  @Booleano({ etiqueta: 'Recibir ofertas', presencia: 'obligatorio' })
  acepta: boolean;
}
