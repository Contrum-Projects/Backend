import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Entrada para crear una marca (E3-H4, RF-03.05). */
export class CrearMarcaDto {
  @ApiProperty({ example: "L'Oréal Professionnel", maxLength: 100 })
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la marca es obligatorio.' })
  @MaxLength(100)
  nombre: string;
}
