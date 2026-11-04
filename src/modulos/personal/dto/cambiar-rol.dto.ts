import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';
import { ROLES, type Rol } from '../../../common/dominio/roles.js';
import { recortarTexto } from '../../../common/validacion/presencia.js';

/** Roles a los que se puede bajar una cuenta (E13-H3): el personal o el cliente. */
export const ROLES_DESTINO_DEGRADACION: readonly Rol[] = [
  ROLES.VENDEDOR,
  ROLES.BODEGUERO,
  ROLES.CLIENTE,
];

/** Largo del motivo ya recortado (decisión del 4 nov 2026, E13-H3; el mismo del rechazo, E10-H3). */
export const MINIMO_MOTIVO_CAMBIO_ROL = 10;
export const MAXIMO_MOTIVO_CAMBIO_ROL = 1000;

const pasaACliente = (objeto: object): boolean =>
  (objeto as CambiarRolDto).rol === ROLES.CLIENTE;

const mensajeMotivo = ({ value }: ValidationArguments): string => {
  if (value === undefined || value === null) {
    return 'El motivo es obligatorio al quitar el rol profesional.';
  }
  if (typeof value !== 'string') return 'El motivo debe ser un texto.';
  if (value.length > MAXIMO_MOTIVO_CAMBIO_ROL) {
    return `El motivo no puede superar los ${MAXIMO_MOTIVO_CAMBIO_ROL} caracteres.`;
  }
  return `El motivo debe tener al menos ${MINIMO_MOTIVO_CAMBIO_ROL} caracteres.`;
};

/**
 * Motivo del cambio: se recorta y un texto vacío equivale a no enviarlo. Obligatorio al pasar a
 * cliente, porque se envía por correo; para el personal, opcional. Si viene, de 10 a 1000.
 */
const MotivoCambioRol = () =>
  applyDecorators(
    recortarTexto(true),
    ValidateIf(
      (objeto: object, valor: unknown) =>
        pasaACliente(objeto) || (valor !== undefined && valor !== null),
    ),
    ValidateBy({
      name: 'motivoCambioRol',
      validator: {
        validate: (valor: unknown) =>
          typeof valor === 'string' &&
          valor.length >= MINIMO_MOTIVO_CAMBIO_ROL &&
          valor.length <= MAXIMO_MOTIVO_CAMBIO_ROL,
        defaultMessage: mensajeMotivo,
      },
    }),
  );

/** Cambio del rol de una cuenta por uno con menos permisos (E13-H3, RF-13.04). */
export class CambiarRolDto {
  @ApiProperty({
    enum: ROLES_DESTINO_DEGRADACION,
    example: 'vendedor',
    description:
      'Un administrador pasa a vendedor o bodeguero; un profesional, a cliente.',
  })
  @IsIn(ROLES_DESTINO_DEGRADACION, {
    message: 'El rol debe ser vendedor, bodeguero o cliente.',
  })
  rol: Rol;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: MINIMO_MOTIVO_CAMBIO_ROL,
    maxLength: MAXIMO_MOTIVO_CAMBIO_ROL,
    example: 'Dejó de ejercer como peluquera según nos informó.',
    description:
      'Obligatorio al pasar de profesional a cliente: se le envía por correo. Opcional para el personal.',
  })
  @MotivoCambioRol()
  motivo?: string | null;
}
