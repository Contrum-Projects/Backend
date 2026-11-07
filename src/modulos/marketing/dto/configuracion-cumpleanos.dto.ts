import { ApiProperty } from '@nestjs/swagger';

/** La oferta guardada del saludo. */
export class OfertaGuardadaCumpleanosDto {
  @ApiProperty({ example: true })
  activa: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '20 % de descuento durante tu semana de cumpleaños.',
    description: 'Se conserva aunque la oferta esté inactiva.',
  })
  texto: string | null;
}

/** Respuesta de `GET` y `PUT /api/marketing/cumpleanos` (E12-H5, SCRUM-150). */
export class ConfiguracionCumpleanosDto {
  @ApiProperty({
    example: true,
    description: 'Si el saludo sale. Por defecto, activo.',
  })
  activo: boolean;

  @ApiProperty({ example: '¡Feliz cumpleaños de parte de Cabello Perfecto!' })
  asunto: string;

  @ApiProperty({ description: 'Saludo en texto plano.' })
  cuerpo: string;

  @ApiProperty({ type: OfertaGuardadaCumpleanosDto })
  oferta: OfertaGuardadaCumpleanosDto;

  @ApiProperty({
    example: true,
    description:
      '`false` mientras nunca se guardó: rige el saludo por defecto, sin oferta.',
  })
  configurado: boolean;

  @ApiProperty({
    example: 12,
    description:
      'Cuentas que cumplen años este mes (hora de Chile) y recibirían el saludo: activas, con correo verificado y que aceptan publicidad. 0 con el saludo apagado.',
  })
  programadosEsteMes: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 41,
    description:
      'Porcentaje (0 a 100, sin decimales) de los saludos enviados el mes calendario anterior que se abrieron. `null` si ese mes no se envió ninguno.',
  })
  porcentajeAperturaUltimoMes: number | null;
}
