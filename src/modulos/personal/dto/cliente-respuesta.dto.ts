import { ApiProperty } from '@nestjs/swagger';
import {
  ROLES,
  ROLES_COMPRADOR,
  type Rol,
} from '../../../common/dominio/roles.js';
import { ESTADOS_SOLICITUD } from '../../../common/dominio/valores.js';

type EstadoSolicitud =
  (typeof ESTADOS_SOLICITUD)[keyof typeof ESTADOS_SOLICITUD];
type RolComprador = typeof ROLES.CLIENTE | typeof ROLES.PROFESIONAL;

/** Una cuenta de cliente o profesional en el listado del panel (E13-H4). */
export class ClienteListadoDto {
  @ApiProperty({ format: 'uuid' })
  codigoPublico: string;

  @ApiProperty({ example: 'Andrea' })
  nombre: string;

  @ApiProperty({ example: 'Soto' })
  apellido: string;

  @ApiProperty({ example: 'andrea@correo.cl' })
  email: string;

  @ApiProperty({ type: String, nullable: true, example: '12345678-5' })
  rut: string | null;

  @ApiProperty({ enum: ROLES_COMPRADOR })
  rol: RolComprador;

  @ApiProperty()
  activo: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  fechaRegistro: Date;

  @ApiProperty({ description: 'Si confirmó su correo.' })
  correoConfirmado: boolean;
}

class ConteosClientesDto {
  @ApiProperty({ example: 120 })
  todos: number;

  @ApiProperty({ example: 98 })
  clientes: number;

  @ApiProperty({ example: 22 })
  profesionales: number;

  @ApiProperty({ example: 3 })
  desactivados: number;
}

/** Página del listado de clientes y profesionales (E13-H4). */
export class ListadoClientesDto {
  @ApiProperty({ type: [ClienteListadoDto] })
  items: ClienteListadoDto[];

  @ApiProperty({ example: 120 })
  total: number;

  @ApiProperty({ example: 1 })
  pagina: number;

  @ApiProperty({ example: 20 })
  limite: number;

  @ApiProperty({
    type: ConteosClientesDto,
    description:
      'Cuentas de cada filtro con la búsqueda aplicada, sin el filtro de rol ni de estado.',
  })
  conteos: ConteosClientesDto;
}

class PerfilProfesionalClienteDto {
  @ApiProperty({ example: 8 })
  anosExperiencia: number;

  @ApiProperty({ example: 'salon' })
  modalidad: string;

  @ApiProperty({ type: [String], example: ['color', 'corte'] })
  especialidades: string[];

  @ApiProperty({ type: String, nullable: true })
  nombreLugarTrabajo: string | null;

  @ApiProperty({ type: String, nullable: true })
  redSocial: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Providencia' })
  comuna: string | null;
}

class VerificacionClienteDto {
  @ApiProperty({ enum: Object.values(ESTADOS_SOLICITUD) })
  estado: EstadoSolicitud;

  @ApiProperty({ type: String, format: 'date-time' })
  fechaSolicitud: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  fechaResolucion: Date | null;
}

class CambioRolClienteDto {
  @ApiProperty({ example: 'profesional' })
  rolAnterior: Rol;

  @ApiProperty({ example: 'cliente' })
  rolNuevo: Rol;

  @ApiProperty({ type: String, nullable: true })
  motivo: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  fechaCambio: Date;

  @ApiProperty({
    example: 'Javiera Muñoz',
    description: 'Nombre y apellido de quien hizo el cambio.',
  })
  responsable: string;
}

/** Detalle de una cuenta de cliente o profesional en el panel (E13-H4). */
export class ClienteDetalleDto extends ClienteListadoDto {
  @ApiProperty({ type: String, nullable: true, example: '+56912345678' })
  telefono: string | null;

  @ApiProperty({ description: 'Si acepta los correos de ofertas.' })
  aceptaMarketingEmail: boolean;

  @ApiProperty({ type: PerfilProfesionalClienteDto, nullable: true })
  perfilProfesional: PerfilProfesionalClienteDto | null;

  @ApiProperty({
    type: VerificacionClienteDto,
    nullable: true,
    description:
      'Su solicitud de verificación más reciente. El detalle está en `GET /api/verificaciones/{codigoPublico}` con el mismo código.',
  })
  verificacion: VerificacionClienteDto | null;

  @ApiProperty({
    example: 4,
    description: 'Pedidos creados, en cualquier estado.',
  })
  pedidos: number;

  @ApiProperty({
    type: [CambioRolClienteDto],
    description: 'Cambios de rol, del más reciente al más antiguo.',
  })
  historialRol: CambioRolClienteDto[];
}
