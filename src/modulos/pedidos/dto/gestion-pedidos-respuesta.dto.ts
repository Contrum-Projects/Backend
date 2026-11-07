import { ApiProperty } from '@nestjs/swagger';
import {
  ESTADOS_PEDIDO,
  TIPOS_ARTICULO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
} from '../../../common/dominio/valores.js';
import { ESTADOS_DESCARGA_DOCUMENTO } from '../../facturacion/documento-pedido.js';

/** Respuestas de `/api/gestion/pedidos` (E8-H2, SCRUM-150), declaradas para el Swagger. */

const ENTREGAS = Object.values(TIPOS_ENTREGA);
const ESTADOS = Object.values(ESTADOS_PEDIDO);

class PedidoGestionDto {
  @ApiProperty({ example: 'AB12CD34EF56' })
  codigoPublico: string;

  @ApiProperty({ format: 'date-time' })
  fechaPedido: string;

  @ApiProperty({
    example: 'Camila Rojas',
    description:
      'Razón social si pidió factura; si no, nombre y apellido de la cuenta.',
  })
  cliente: string;

  @ApiProperty({ enum: ENTREGAS })
  tipoEntrega: (typeof ENTREGAS)[number];

  @ApiProperty({ enum: ESTADOS })
  estado: (typeof ESTADOS)[number];

  @ApiProperty({ example: 25990, description: 'Total con IVA, en pesos.' })
  total: number;

  @ApiProperty({
    example: 3,
    description: 'Suma de las cantidades del pedido.',
  })
  unidades: number;
}

class GrupoPedidosDto {
  @ApiProperty({ example: 'por_preparar' })
  clave: string;

  @ApiProperty({ example: 'Por preparar' })
  nombre: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 4,
    description: '`null`: el grupo no muestra cuántos pedidos tiene.',
  })
  cantidad: number | null;
}

export class ListadoPedidosGestionDto {
  @ApiProperty({ type: [PedidoGestionDto] })
  items: PedidoGestionDto[];

  @ApiProperty({ example: 12 })
  total: number;

  @ApiProperty({ example: 1 })
  pagina: number;

  @ApiProperty({ example: 20 })
  limite: number;

  @ApiProperty({
    type: [GrupoPedidosDto],
    description: 'Los chips del filtro, en orden.',
  })
  grupos: GrupoPedidosDto[];

  @ApiProperty({ example: 'por_preparar', description: 'El grupo aplicado.' })
  grupo: string;
}

class MontosDto {
  @ApiProperty({ example: 21840 })
  neto: number;

  @ApiProperty({ example: 4150 })
  iva: number;

  @ApiProperty({ example: 25990 })
  total: number;

  @ApiProperty({
    example: 0,
    description:
      'Lo que descontó el cupón, con IVA (SCRUM-150); ya va restado del neto, el IVA y el total.',
  })
  descuento: number;
}

class LineaPedidoDto {
  @ApiProperty({ example: 21 })
  articuloId: number;

  @ApiProperty({ enum: Object.values(TIPOS_ARTICULO) })
  tipo: (typeof TIPOS_ARTICULO)[keyof typeof TIPOS_ARTICULO];

  @ApiProperty({ example: 'Shampoo reparador' })
  nombre: string;

  @ApiProperty({ type: String, nullable: true, example: '300 ml' })
  nombreFormato: string | null;

  @ApiProperty({ type: String, nullable: true })
  imagen: string | null;

  @ApiProperty({ example: 2 })
  cantidad: number;

  @ApiProperty({
    example: 12990,
    description: 'Precio unitario con IVA que se cobró.',
  })
  precioUnitario: number;

  @ApiProperty({ example: 25980 })
  subtotal: number;
}

class ComunaDto {
  @ApiProperty({ example: '13101' })
  codigoCut: string;

  @ApiProperty({ example: 'Santiago' })
  nombre: string;
}

class EnvioPedidoDto {
  @ApiProperty({ example: 'DIA HABIL SIGUIENTE' })
  servicio: string;

  @ApiProperty({ example: 3990, description: 'Costo con IVA, en pesos.' })
  costo: number;

  @ApiProperty({ example: 'pendiente' })
  estado: string;

  @ApiProperty({ type: String, nullable: true })
  codigoSeguimiento: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  fechaEstimada: string | null;

  @ApiProperty()
  destinatario: string;

  @ApiProperty({ type: String, nullable: true })
  telefonoContacto: string | null;

  @ApiProperty()
  calle: string;

  @ApiProperty()
  numero: string;

  @ApiProperty({ type: String, nullable: true })
  referencia: string | null;

  @ApiProperty({ type: ComunaDto })
  comuna: ComunaDto;
}

class DocumentoPedidoDto {
  @ApiProperty({ enum: [TIPOS_DOCUMENTO.FACTURA] })
  tipo: typeof TIPOS_DOCUMENTO.FACTURA;

  @ApiProperty({ enum: Object.values(ESTADOS_DESCARGA_DOCUMENTO) })
  estado: (typeof ESTADOS_DESCARGA_DOCUMENTO)[keyof typeof ESTADOS_DESCARGA_DOCUMENTO];

  @ApiProperty({ type: Number, nullable: true })
  folio: number | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  fechaEmision: string | null;
}

class ClientePedidoDto {
  @ApiProperty({ example: 'Camila Rojas' })
  nombre: string;

  @ApiProperty({ example: 'camila@correo.cl' })
  correo: string;

  @ApiProperty({ type: String, nullable: true })
  telefono: string | null;
}

class CambioHistorialDto {
  @ApiProperty({ enum: ESTADOS })
  estado: (typeof ESTADOS)[number];

  @ApiProperty({ format: 'date-time' })
  fecha: string;

  @ApiProperty({ type: String, nullable: true })
  comentario: string | null;

  @ApiProperty({
    example: 'Sistema',
    description: '«Sistema», «Cliente» o el nombre del personal.',
  })
  realizadoPor: string;
}

class CambioPermitidoDto {
  @ApiProperty({ enum: ESTADOS })
  estado: (typeof ESTADOS)[number];

  @ApiProperty({ enum: ['avance', 'retroceso'] })
  sentido: 'avance' | 'retroceso';

  @ApiProperty({
    description: 'Al despachar se pide la OT de Chilexpress (E7-H3).',
  })
  pideCodigoSeguimiento: boolean;

  @ApiProperty({ description: 'Se avisa al cliente por correo.' })
  avisaAlCliente: boolean;

  @ApiProperty({
    description: 'Volver a un estado anterior exige un comentario.',
  })
  pideComentario: boolean;
}

export class DetallePedidoGestionDto {
  @ApiProperty({ example: 'AB12CD34EF56' })
  codigoPublico: string;

  @ApiProperty({ format: 'date-time' })
  fechaPedido: string;

  @ApiProperty({ enum: ESTADOS })
  estado: (typeof ESTADOS)[number];

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'Hasta cuándo se puede pagar; solo mientras espera el pago.',
  })
  pagarHasta: string | null;

  @ApiProperty({ enum: ENTREGAS })
  tipoEntrega: (typeof ENTREGAS)[number];

  @ApiProperty({ enum: Object.values(TIPOS_DOCUMENTO) })
  tipoDocumento: (typeof TIPOS_DOCUMENTO)[keyof typeof TIPOS_DOCUMENTO];

  @ApiProperty({ example: 19 })
  porcentajeIva: number;

  @ApiProperty({ type: MontosDto })
  montos: MontosDto;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'LOREAL20',
    description: 'Código del cupón aplicado (SCRUM-150).',
  })
  cupon: string | null;

  @ApiProperty({ type: [LineaPedidoDto] })
  items: LineaPedidoDto[];

  @ApiProperty({ type: EnvioPedidoDto, nullable: true })
  envio: EnvioPedidoDto | null;

  @ApiProperty({ type: DocumentoPedidoDto, nullable: true })
  documento: DocumentoPedidoDto | null;

  @ApiProperty({ type: String, nullable: true })
  idTransaccionPago: string | null;

  @ApiProperty({ type: ClientePedidoDto })
  cliente: ClientePedidoDto;

  @ApiProperty({
    type: [CambioHistorialDto],
    description: 'Del primero al último.',
  })
  historial: CambioHistorialDto[];

  @ApiProperty({ type: [CambioPermitidoDto] })
  cambiosPermitidos: CambioPermitidoDto[];

  @ApiProperty({ description: 'Solo un pedido pendiente de pago (E8-H3).' })
  sePuedeCancelar: boolean;
}
