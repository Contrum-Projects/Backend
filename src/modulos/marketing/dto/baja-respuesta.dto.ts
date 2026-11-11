import { ApiProperty } from '@nestjs/swagger';

/** Respuesta de la baja de una dirección desde el panel (E12-H2). */
export class BajaRespuestaDto {
  @ApiProperty({ example: 'camila@correo.cl' })
  email: string;

  @ApiProperty({ description: 'Hay una cuenta con esa dirección.' })
  cuenta: boolean;

  @ApiProperty({
    description: 'Hay una suscripción sin cuenta (LEAD) con esa dirección.',
  })
  suscripcion: boolean;

  @ApiProperty({
    example: 'Listo. camila@correo.cl ya no recibirá publicidad.',
  })
  mensaje: string;
}
