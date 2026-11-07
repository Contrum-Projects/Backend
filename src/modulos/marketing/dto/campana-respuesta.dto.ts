import { ApiProperty } from '@nestjs/swagger';
import { TIPOS_DESTINATARIO_CAMPANA } from '../../../common/dominio/valores.js';
import type { TipoDestinatario } from '../segmento-campana.js';

/**
 * Respuestas de `/api/marketing/campanas` (E12-H3), declaradas en el Swagger para que el frontend
 * genere sus tipos (SCRUM-150).
 */

/** El segmento guardado de una campaña: siempre con todos sus campos, aunque vengan vacíos. */
export class SegmentoGuardadoDto {
  @ApiProperty({
    enum: Object.values(TIPOS_DESTINATARIO_CAMPANA),
    isArray: true,
    example: [TIPOS_DESTINATARIO_CAMPANA.PROFESIONAL],
  })
  tipos: TipoDestinatario[];

  @ApiProperty({
    type: [Number],
    example: [3],
    description: 'Ids de las categorías (con sus subcategorías).',
  })
  categorias: number[];

  @ApiProperty({
    type: [Number],
    example: [],
    description: 'Ids de las marcas.',
  })
  marcas: number[];
  // Filtros de cuenta (SCRUM-150): `null` o lista vacía es «sin ese filtro»

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Con un pedido pagado en los últimos N días.',
  })
  compraEnUltimosDias: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Último pedido pagado hace más de N días.',
  })
  sinComprarHaceDias: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Mínimo de pedidos pagados.',
  })
  pedidosMinimo: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Máximo de pedidos pagados.',
  })
  pedidosMaximo: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Gasto mínimo con IVA, en pesos.',
  })
  gastoMinimo: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Gasto máximo con IVA, en pesos.',
  })
  gastoMaximo: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Edad mínima en años cumplidos.',
  })
  edadMinima: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Edad máxima en años cumplidos.',
  })
  edadMaxima: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Cuenta creada en los últimos N días.',
  })
  registroUltimosDias: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Cuenta creada hace más de N días.',
  })
  registroHaceMasDias: number | null;

  @ApiProperty({
    type: [String],
    description: 'Código CUT de las regiones de sus direcciones.',
  })
  regiones: string[];

  @ApiProperty({
    type: [String],
    description: 'Código CUT de las comunas de sus direcciones.',
  })
  comunas: string[];

  @ApiProperty({ type: [Number], description: 'Meses de cumpleaños (1 a 12).' })
  mesesCumpleanos: number[];

  @ApiProperty({
    type: [String],
    description: 'Géneros, tal como los escribió la cuenta.',
  })
  generos: string[];

  @ApiProperty({ description: 'Solo cuentas con productos en el carrito.' })
  conCarrito: boolean;
}

class AutorCampanaDto {
  @ApiProperty({ example: 'Camila' })
  nombre: string;

  @ApiProperty({ example: 'Rojas' })
  apellido: string;
}

export class CampanaPanelDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Nueva línea reparadora' })
  asunto: string;

  @ApiProperty({
    description: 'Texto plano: una línea en blanco separa los párrafos.',
  })
  cuerpo: string;

  @ApiProperty({ type: SegmentoGuardadoDto })
  segmento: SegmentoGuardadoDto;

  @ApiProperty({ example: false, description: 'Si ya se confirmó el envío.' })
  enviada: boolean;

  @ApiProperty({ example: '2026-11-04T15:30:00.000Z', format: 'date-time' })
  fechaCreacion: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'Cuándo se confirmó el envío; `null` en un borrador.',
  })
  fechaEnvio: string | null;

  @ApiProperty({ type: AutorCampanaDto })
  creadaPor: AutorCampanaDto;
}

export class ContactosCampanasDto {
  @ApiProperty({
    example: 812,
    description:
      'Direcciones que recibirían hoy una campaña a todos (cuentas y suscriptores sin cuenta, cada una una vez).',
  })
  aceptanPublicidad: number;

  @ApiProperty({
    example: 640,
    description:
      'Cuentas cliente o profesional activas, con el correo verificado, que aceptan publicidad.',
  })
  cuentasVerificadas: number;

  @ApiProperty({
    example: 172,
    description:
      'Suscriptores confirmados, sin baja y sin una cuenta con el mismo correo.',
  })
  suscriptoresSinCuenta: number;

  @ApiProperty({
    example: 9,
    description: 'Direcciones con algún correo rebotado.',
  })
  conRebote: number;
}

export class CampanaListadaDto extends CampanaPanelDto {
  @ApiProperty({
    example: 812,
    description:
      'Borrador: cuántas direcciones la recibirían hoy. Enviada: a cuántas salió.',
  })
  destinatarios: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 41,
    description:
      'Enviada: de los correos enviados, cuántos se abrieron (0 a 100, sin decimales). `null` en un borrador o sin envíos.',
  })
  porcentajeApertura: number | null;
}

export class ListadoCampanasDto {
  @ApiProperty({ type: ContactosCampanasDto })
  contactos: ContactosCampanasDto;

  @ApiProperty({
    type: [CampanaListadaDto],
    description: 'De la más nueva a la más antigua.',
  })
  items: CampanaListadaDto[];

  @ApiProperty({ example: 14 })
  total: number;

  @ApiProperty({ example: 1 })
  pagina: number;

  @ApiProperty({ example: 20 })
  limite: number;
}

class EnviosCampanaDto {
  @ApiProperty({ example: 120 })
  total: number;

  @ApiProperty({ example: 0 })
  pendientes: number;

  @ApiProperty({ example: 115 })
  enviados: number;

  @ApiProperty({ example: 1 })
  fallidos: number;

  @ApiProperty({ example: 2 })
  cancelados: number;

  @ApiProperty({ example: 2 })
  rebotados: number;
}

export class DetalleCampanaDto extends CampanaPanelDto {
  @ApiProperty({
    type: EnviosCampanaDto,
    description: 'Sus correos por estado.',
  })
  envios: EnviosCampanaDto;
}

export class VistaPreviaCampanaDto {
  @ApiProperty({ example: 'Nueva línea reparadora' })
  asunto: string;

  @ApiProperty({ description: 'HTML del correo.' })
  html: string;

  @ApiProperty({ description: 'Versión en texto plano del correo.' })
  texto: string;

  @ApiProperty({
    example: 812,
    description: 'Direcciones que lo recibirían hoy (cada una una vez).',
  })
  destinatarios: number;

  @ApiProperty({
    description: 'Se entrega en `POST /:id/envio`. Vence a la hora.',
  })
  confirmacion: string;
}

export class CampanaEnviadaDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: '2026-11-06T15:30:00.000Z', format: 'date-time' })
  fechaEnvio: string;

  @ApiProperty({ example: 812 })
  destinatarios: number;
}
