import { ApiProperty } from '@nestjs/swagger';
import { TIPOS_DOCUMENTO_PROVEEDOR } from '../../../common/dominio/valores.js';
import { UbicacionResumenDto } from './movimiento-listado.dto.js';

/** Respuestas de `/api/inventario/entradas` (E11-H2, SCRUM-150), declaradas para el Swagger. */

const TIPOS_DOCUMENTO = Object.values(TIPOS_DOCUMENTO_PROVEEDOR);

class ProveedorEntradaRegistradaDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: '76086430-7' })
  rut: string;

  @ApiProperty({ example: 'Distribuidora Capilar SpA' })
  razonSocial: string;
}

class DetalleEntradaRegistradoDto {
  @ApiProperty({ example: 21 })
  formatoId: number;

  @ApiProperty({ example: 24 })
  cantidad: number;

  @ApiProperty({ example: 1990.5 })
  costoUnitarioNeto: number;

  @ApiProperty({
    example: 47772,
    description: 'Cantidad por costo unitario neto.',
  })
  subtotalNeto: number;

  @ApiProperty({
    example: 90,
    description: 'El movimiento de entrada del formato.',
  })
  movimientoId: number;
}

export class EntradaRegistradaDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ type: ProveedorEntradaRegistradaDto })
  proveedor: ProveedorEntradaRegistradaDto;

  @ApiProperty({ example: '2026-11-06', format: 'date' })
  fechaRecepcion: string;

  @ApiProperty({ enum: TIPOS_DOCUMENTO })
  tipoDocumento: (typeof TIPOS_DOCUMENTO)[number];

  @ApiProperty({ example: 'F-1234' })
  numeroDocumento: string;

  @ApiProperty({ type: String, nullable: true })
  observacion: string | null;

  @ApiProperty({ type: UbicacionResumenDto })
  ubicacion: UbicacionResumenDto;

  @ApiProperty({ type: [DetalleEntradaRegistradoDto] })
  detalles: DetalleEntradaRegistradoDto[];

  @ApiProperty({ example: 30, description: 'Unidades recibidas en total.' })
  unidades: number;

  @ApiProperty({ example: 95772, description: 'Suma de los subtotales netos.' })
  costoNetoTotal: number;
}

class ProveedorListadoDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Distribuidora Capilar SpA' })
  razonSocial: string;
}

class RegistradoPorEntradaDto {
  @ApiProperty({ example: 'Camila Rojas' })
  nombre: string;
}

export class EntradaListadoDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: '2026-11-06', format: 'date' })
  fechaRecepcion: string;

  @ApiProperty({ enum: TIPOS_DOCUMENTO })
  tipoDocumento: (typeof TIPOS_DOCUMENTO)[number];

  @ApiProperty({ example: 'F-1234' })
  numeroDocumento: string;

  @ApiProperty({ type: ProveedorListadoDto })
  proveedor: ProveedorListadoDto;

  @ApiProperty({
    type: UbicacionResumenDto,
    description: 'La ubicación de destino de la entrada.',
  })
  ubicacion: UbicacionResumenDto;

  @ApiProperty({ example: 2, description: 'Formatos distintos recibidos.' })
  cantidadFormatos: number;

  @ApiProperty({ example: 30 })
  unidades: number;

  @ApiProperty({ example: 95772 })
  costoNetoTotal: number;

  @ApiProperty({ type: RegistradoPorEntradaDto })
  registradoPor: RegistradoPorEntradaDto;
}

export class ListadoEntradasDto {
  @ApiProperty({ type: [EntradaListadoDto] })
  items: EntradaListadoDto[];

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  pagina: number;

  @ApiProperty({ example: 20 })
  limite: number;
}
