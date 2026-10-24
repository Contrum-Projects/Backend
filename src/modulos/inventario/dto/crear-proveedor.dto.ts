import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Correo } from '../../../common/validacion/correo.js';
import { Rut } from '../../../common/validacion/rut.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

/** Entrada del registro de un proveedor (E11-H1, RF-11.01). */
export class CrearProveedorDto {
  @ApiProperty({
    example: '76.086.428-5',
    description: 'Con o sin puntos y guion. Se guarda como 76086428-5.',
  })
  @Rut()
  rut: string;

  @ApiProperty({ example: 'Distribuidora Capilar SpA', maxLength: 150 })
  @TextoObligatorio({
    etiqueta: 'La razón social',
    maximo: 150,
    femenino: true,
  })
  razonSocial: string;

  @ApiPropertyOptional({ example: 'Marcela Soto', maxLength: 150 })
  @TextoOpcional({ etiqueta: 'El nombre de contacto', maximo: 150 })
  nombreContacto?: string | null;

  @ApiPropertyOptional({ example: '+56412345678', maxLength: 20 })
  @TextoOpcional({ etiqueta: 'El teléfono', maximo: 20 })
  telefono?: string | null;

  @ApiPropertyOptional({ example: 'ventas@distribuidora.cl', maxLength: 254 })
  @Correo({ presencia: 'borrable' })
  email?: string | null;
}
