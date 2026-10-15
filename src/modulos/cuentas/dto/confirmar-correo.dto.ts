import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Entrada de la confirmación del correo (E1-H1, RF-01.02). */
export class ConfirmarCorreoDto {
  @ApiProperty({ description: 'Token recibido en el enlace del correo.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token: string;
}
