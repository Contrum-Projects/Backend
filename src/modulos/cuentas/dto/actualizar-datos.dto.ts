import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { normalizarRut } from '../../../common/dominio/rut.js';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Para los datos opcionales: un texto vacío borra el dato, igual que `null`. */
const recortarOVaciar = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const recortado = value.trim();
  return recortado === '' ? null : recortado;
};

@ValidatorConstraint({ name: 'rutValido' })
class RutValido implements ValidatorConstraintInterface {
  validate(valor: unknown) {
    return typeof valor === 'string' && normalizarRut(valor) === valor;
  }

  defaultMessage() {
    return 'El RUT no es válido.';
  }
}

/**
 * Edición de los datos personales (E1-H5, RF-01.07). Solo cambia lo que viene; en los datos
 * opcionales, `null` o un texto vacío los borra. El correo no se edita aquí (decisión del 20 oct).
 */
export class ActualizarDatosDto {
  @ApiPropertyOptional({ example: 'Camila', maxLength: 100 })
  @ValidateIf((_, valor) => valor !== undefined)
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  @MaxLength(100)
  nombre?: string;

  @ApiPropertyOptional({ example: 'Rojas', maxLength: 100 })
  @ValidateIf((_, valor) => valor !== undefined)
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'El apellido es obligatorio.' })
  @MaxLength(100)
  apellido?: string;

  @ApiPropertyOptional({
    example: '+56912345678',
    maxLength: 20,
    nullable: true,
  })
  @IsOptional()
  @Transform(recortarOVaciar)
  @IsString()
  @MaxLength(20)
  telefono?: string | null;

  @ApiPropertyOptional({
    example: '12.345.678-5',
    description:
      'Se guarda como 12345678-5. El profesional no puede cambiarlo ni borrarlo.',
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    const valor = recortarOVaciar({ value });
    return typeof valor === 'string' ? (normalizarRut(valor) ?? valor) : valor;
  })
  @Validate(RutValido)
  rut?: string | null;

  @ApiPropertyOptional({
    example: '1990-05-21',
    format: 'date',
    nullable: true,
  })
  @IsOptional()
  @Transform(recortarOVaciar)
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'La fecha de nacimiento no es válida.' },
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de nacimiento debe tener el formato AAAA-MM-DD.',
  })
  fechaNacimiento?: string | null;

  @ApiPropertyOptional({ maxLength: 30, nullable: true })
  @IsOptional()
  @Transform(recortarOVaciar)
  @IsString()
  @MaxLength(30)
  genero?: string | null;
}
