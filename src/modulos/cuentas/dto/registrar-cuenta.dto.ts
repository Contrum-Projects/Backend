import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals } from 'class-validator';
import {
  ContrasenaIngresada,
  ContrasenaNueva,
} from '../../../common/validacion/contrasena.js';
import { Correo } from '../../../common/validacion/correo.js';
import { FechaSinHora } from '../../../common/validacion/fecha-sin-hora.js';
import { Rut } from '../../../common/validacion/rut.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

/** Mensaje cuando el registro llega sin aceptar las ofertas por correo. */
export const MENSAJE_ACEPTA_MARKETING =
  'Para crear tu cuenta debes aceptar recibir ofertas por correo.';

/** Entrada del registro (E1-H1, RF-01.01). */
export class RegistrarCuentaDto {
  @ApiProperty({ example: 'Camila', maxLength: 100 })
  @TextoObligatorio({ etiqueta: 'El nombre', maximo: 100 })
  nombre: string;

  @ApiProperty({ example: 'Rojas', maxLength: 100 })
  @TextoObligatorio({ etiqueta: 'El apellido', maximo: 100 })
  apellido: string;

  @ApiProperty({ example: 'camila@correo.cl', maxLength: 254 })
  @Correo()
  email: string;

  @ApiProperty({
    description: 'Mínimo 8 caracteres, con al menos una letra y un número.',
    minLength: 8,
    maxLength: 128,
  })
  @ContrasenaNueva()
  contrasena: string;

  @ApiProperty({ description: 'Debe ser igual a la contraseña.' })
  @ContrasenaIngresada({ etiqueta: 'La confirmación de la contraseña' })
  confirmacionContrasena: string;

  @ApiPropertyOptional({ example: '+56912345678', maxLength: 20 })
  @TextoOpcional({ etiqueta: 'El teléfono', maximo: 20 })
  telefono?: string | null;

  @ApiPropertyOptional({
    example: '12.345.678-5',
    description: 'Se guarda como 12345678-5.',
  })
  @Rut({ presencia: 'borrable' })
  rut?: string | null;

  @ApiPropertyOptional({ example: '1990-05-21', format: 'date' })
  @FechaSinHora({ etiqueta: 'La fecha de nacimiento' })
  fechaNacimiento?: string | null;

  @ApiPropertyOptional({ maxLength: 30 })
  @TextoOpcional({ etiqueta: 'El género', maximo: 30 })
  genero?: string | null;

  /**
   * Recibir ofertas por correo (RF-12.02). Es condición para crear la cuenta (decisión del equipo
   * del 11 de noviembre de 2026): si falta o no es `true`, 400.
   */
  @ApiProperty({
    type: Boolean,
    example: true,
    description:
      'Debe ser true: para crear la cuenta hay que aceptar recibir ofertas por correo.',
  })
  @Equals(true, { message: MENSAJE_ACEPTA_MARKETING })
  aceptaMarketing: boolean;
}
