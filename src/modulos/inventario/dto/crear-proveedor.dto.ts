import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { normalizarRut } from '../../../common/dominio/rut.js';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ValidatorConstraint({ name: 'rutProveedorValido' })
class RutValido implements ValidatorConstraintInterface {
  validate(valor: unknown) {
    return typeof valor === 'string' && normalizarRut(valor) === valor;
  }

  defaultMessage() {
    return 'El RUT no es válido.';
  }
}

/** Entrada del registro de un proveedor (E11-H1, RF-11.01). */
export class CrearProveedorDto {
  @ApiProperty({
    example: '76.086.428-5',
    description: 'Con o sin puntos y guion. Se guarda como 76086428-5.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? (normalizarRut(value) ?? value) : value,
  )
  @Validate(RutValido)
  rut: string;

  @ApiProperty({ example: 'Distribuidora Capilar SpA', maxLength: 150 })
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'La razón social es obligatoria.' })
  @MaxLength(150)
  razonSocial: string;

  @ApiPropertyOptional({ example: 'Marcela Soto', maxLength: 150 })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(150)
  nombreContacto?: string;

  @ApiPropertyOptional({ example: '+56412345678', maxLength: 20 })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(20)
  telefono?: string;

  @ApiPropertyOptional({ example: 'ventas@distribuidora.cl', maxLength: 254 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'El correo no es válido.' })
  @MaxLength(254)
  email?: string;
}
