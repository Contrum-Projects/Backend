import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ROLES_PERSONAL, type Rol } from '../../../common/dominio/roles.js';
import { Correo } from '../../../common/validacion/correo.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';

/** Entrada de la creación de una cuenta del personal (E13-H1, RF-13.01). */
export class CrearPersonalDto {
  @ApiProperty({ example: 'Javiera', maxLength: 100 })
  @TextoObligatorio({ etiqueta: 'El nombre', maximo: 100 })
  nombre: string;

  @ApiProperty({ example: 'Muñoz', maxLength: 100 })
  @TextoObligatorio({ etiqueta: 'El apellido', maximo: 100 })
  apellido: string;

  @ApiProperty({ example: 'javiera@cabelloperfecto.cl', maxLength: 254 })
  @Correo()
  email: string;

  @ApiProperty({ enum: ROLES_PERSONAL, example: 'vendedor' })
  @IsIn(ROLES_PERSONAL, {
    message: 'El rol debe ser vendedor, bodeguero o administrador.',
  })
  rol: Rol;
}
