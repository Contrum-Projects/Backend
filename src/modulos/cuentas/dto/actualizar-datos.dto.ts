import { ApiPropertyOptional } from '@nestjs/swagger';
import { FechaSinHora } from '../../../common/validacion/fecha-sin-hora.js';
import { Rut } from '../../../common/validacion/rut.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

/**
 * Edición de los datos personales (E1-H5, RF-01.09). Solo cambia lo que viene; en los datos
 * opcionales, `null` o un texto vacío los borra. El correo no se edita aquí (decisión del 20 oct).
 */
export class ActualizarDatosDto {
  @ApiPropertyOptional({ example: 'Camila', maxLength: 100 })
  @TextoObligatorio({ etiqueta: 'El nombre', maximo: 100, puedeFaltar: true })
  nombre?: string;

  @ApiPropertyOptional({ example: 'Rojas', maxLength: 100 })
  @TextoObligatorio({
    etiqueta: 'El apellido',
    maximo: 100,
    puedeFaltar: true,
  })
  apellido?: string;

  @ApiPropertyOptional({
    example: '+56912345678',
    maxLength: 20,
    nullable: true,
  })
  @TextoOpcional({ etiqueta: 'El teléfono', maximo: 20 })
  telefono?: string | null;

  @ApiPropertyOptional({
    example: '12.345.678-5',
    description:
      'Se guarda como 12345678-5. El profesional no puede cambiarlo ni borrarlo.',
    nullable: true,
  })
  @Rut({ presencia: 'borrable' })
  rut?: string | null;

  @ApiPropertyOptional({
    example: '1990-05-21',
    format: 'date',
    nullable: true,
  })
  @FechaSinHora({ etiqueta: 'La fecha de nacimiento' })
  fechaNacimiento?: string | null;

  @ApiPropertyOptional({ maxLength: 30, nullable: true })
  @TextoOpcional({ etiqueta: 'El género', maximo: 30 })
  genero?: string | null;
}
