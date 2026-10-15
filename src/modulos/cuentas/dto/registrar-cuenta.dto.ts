import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { normalizarRut } from '../../../common/dominio/rut.js';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ValidatorConstraint({ name: 'rutValido' })
class RutValido implements ValidatorConstraintInterface {
  validate(valor: unknown) {
    return typeof valor === 'string' && normalizarRut(valor) === valor;
  }

  defaultMessage() {
    return 'El RUT no es válido.';
  }
}

/** Entrada del registro (E1-H1, RF-01.01). */
export class RegistrarCuentaDto {
  @ApiProperty({ example: 'Camila', maxLength: 100 })
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  @MaxLength(100)
  nombre: string;

  @ApiProperty({ example: 'Rojas', maxLength: 100 })
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'El apellido es obligatorio.' })
  @MaxLength(100)
  apellido: string;

  @ApiProperty({ example: 'camila@correo.cl', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'El correo no es válido.' })
  @MaxLength(254)
  email: string;

  @ApiProperty({
    description: 'Mínimo 8 caracteres, con al menos una letra y un número.',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(128)
  @Matches(/\p{L}/u, {
    message: 'La contraseña debe tener al menos una letra.',
  })
  @Matches(/\d/, { message: 'La contraseña debe tener al menos un número.' })
  contrasena: string;

  @ApiProperty({ description: 'Debe ser igual a la contraseña.' })
  @IsString()
  confirmacionContrasena: string;

  @ApiPropertyOptional({ example: '+56912345678', maxLength: 20 })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(20)
  telefono?: string;

  @ApiPropertyOptional({
    example: '12.345.678-5',
    description: 'Se guarda como 12345678-5.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? (normalizarRut(value) ?? value) : value,
  )
  @Validate(RutValido)
  rut?: string;

  @ApiPropertyOptional({ example: '1990-05-21', format: 'date' })
  @IsOptional()
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'La fecha de nacimiento no es válida.' },
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de nacimiento debe tener el formato AAAA-MM-DD.',
  })
  fechaNacimiento?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(30)
  genero?: string;
}
