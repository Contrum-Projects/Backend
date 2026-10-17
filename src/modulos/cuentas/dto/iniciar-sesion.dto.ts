import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Entrada del inicio de sesión (E1-H2, RF-01.03). */
export class IniciarSesionDto {
  @ApiProperty({ example: 'camila@correo.cl', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'El correo no es válido.' })
  @MaxLength(254)
  email: string;

  @ApiProperty({ maxLength: 128 })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria.' })
  @MaxLength(128)
  contrasena: string;
}
