import { ApiProperty } from '@nestjs/swagger';

/** Región o comuna de la lista oficial, identificada por su código CUT. */
export class UbicacionOficialDto {
  @ApiProperty({
    example: '13123',
    description: 'Código Único Territorial: 2 dígitos la región, 5 la comuna.',
  })
  codigoCut: string;

  @ApiProperty({ example: 'Providencia' })
  nombre: string;
}
