import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, ValidateIf } from 'class-validator';
import { ROLES_COMPRADOR, type Rol } from '../../../common/dominio/roles.js';
import { Booleano } from '../../../common/validacion/booleano.js';
import { Paginacion } from '../../../common/validacion/paginacion.js';
import { TextoBusqueda } from '../../../common/validacion/texto-busqueda.js';

/** Largo máximo de la búsqueda: un correo completo cabe (254) con margen para el nombre. */
export const MAXIMO_BUSQUEDA_CLIENTES = 254;
/** Cada palabra suma una condición: el tope acota el costo de la consulta. */
export const MAXIMO_PALABRAS_CLIENTES = 5;

/** Filtros y paginación del listado de clientes y profesionales del panel (E13-H4). */
export class ListarClientesDto extends Paginacion {
  @ApiPropertyOptional({
    description:
      'Palabras contenidas en el nombre, el apellido o el correo, sin distinguir mayúsculas; o un RUT, con o sin puntos y guion.',
    maxLength: MAXIMO_BUSQUEDA_CLIENTES,
  })
  @TextoBusqueda({
    maximo: MAXIMO_BUSQUEDA_CLIENTES,
    maximoPalabras: MAXIMO_PALABRAS_CLIENTES,
  })
  buscar?: string;

  @ApiPropertyOptional({
    enum: ROLES_COMPRADOR,
    description: 'Solo las cuentas de este rol.',
  })
  @ValidateIf((_objeto, valor) => valor !== undefined)
  @IsIn(ROLES_COMPRADOR, { message: 'El rol debe ser cliente o profesional.' })
  rol?: Rol;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Con `true`, solo las activas; con `false`, solo las desactivadas. Sin él, todas.',
  })
  @Booleano({ etiqueta: 'Activo', desdeTexto: true })
  activo?: boolean;
}
