import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { ROLES_PERSONAL, type Rol } from '../../../common/dominio/roles.js';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Entrada de la creación de una cuenta del personal (E13-H1, RF-13.01). */
export class CrearPersonalDto {
  @ApiProperty({ example: 'Javiera', maxLength: 100 })
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  @MaxLength(100)
  nombre: string;

  @ApiProperty({ example: 'Muñoz', maxLength: 100 })
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'El apellido es obligatorio.' })
  @MaxLength(100)
  apellido: string;

  @ApiProperty({ example: 'javiera@cabelloperfecto.cl', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'El correo no es válido.' })
  @MaxLength(254)
  email: string;

  @ApiProperty({ enum: ROLES_PERSONAL, example: 'vendedor' })
  @IsIn(ROLES_PERSONAL, {
    message: 'El rol debe ser vendedor, bodeguero o administrador.',
  })
  rol: Rol;
}
