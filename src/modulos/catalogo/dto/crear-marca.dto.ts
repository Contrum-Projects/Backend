import { ApiProperty } from '@nestjs/swagger';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';

/** Entrada para crear una marca (E3-H4, RF-03.05). */
export class CrearMarcaDto {
  @ApiProperty({ example: "L'Oréal Professionnel", maxLength: 100 })
  @TextoObligatorio({
    etiqueta: 'El nombre de la marca',
    maximo: 100,
  })
  nombre: string;
}
