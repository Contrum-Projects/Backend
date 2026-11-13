import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn, Matches } from 'class-validator';
import { TIPOS_BODEGA } from '../../../common/dominio/valores.js';
import { Booleano } from '../../../common/validacion/booleano.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

const TIPOS = Object.values(TIPOS_BODEGA);

/** Una bodega o sala de ventas (SCRUM-151). Nace activa. */
export class CrearBodegaDto {
  @ApiProperty({ example: 'Bodega central', maxLength: 100 })
  @TextoObligatorio({ etiqueta: 'El nombre de la bodega', maximo: 100 })
  nombre: string;

  @ApiProperty({ example: 'Av. Matta 1234', maxLength: 200 })
  @TextoObligatorio({
    etiqueta: 'La dirección',
    maximo: 200,
    femenino: true,
  })
  direccion: string;

  @ApiProperty({ example: '13101', description: 'Código CUT de la comuna.' })
  @Matches(/^\d{5}$/, { message: 'La comuna no es válida.' })
  comuna: string;

  @ApiProperty({ enum: TIPOS, example: TIPOS_BODEGA.BODEGA })
  @IsIn(TIPOS, {
    message: `El tipo debe ser uno de estos: ${TIPOS.join(', ')}.`,
  })
  tipo: string;

  @ApiPropertyOptional({
    description: 'Si su stock cuenta para la venta online (por omisión, sí).',
  })
  @Booleano({ etiqueta: 'Abastece la venta online' })
  abasteceVentaOnline?: boolean;
}

/** Edición: cada campo que llega reemplaza al anterior. `activa: false` exige que no tenga stock. */
export class ActualizarBodegaDto extends PartialType(CrearBodegaDto) {
  @ApiPropertyOptional({
    description:
      'Desactivarla exige que ninguna de sus ubicaciones tenga stock.',
  })
  @Booleano({ etiqueta: 'Activa' })
  activa?: boolean;

  @ApiPropertyOptional({
    description:
      'Marcarla como la bodega de despacho (SCRUM-153): origen de la cotización y de las OT. Solo una lo es; marcar otra le quita la marca a la anterior. Debe estar activa.',
  })
  @Booleano({ etiqueta: 'Bodega de despacho' })
  esDespacho?: boolean;
}

const Parte = (etiqueta: string) => TextoOpcional({ etiqueta, maximo: 20 });

/** Una ubicación dentro de una bodega (SCRUM-151): código único en esa bodega. */
export class CrearUbicacionDto {
  @ApiProperty({
    example: 'A-01',
    maxLength: 30,
    description: 'Se guarda en mayúsculas; único dentro de la bodega.',
  })
  @TextoObligatorio({ etiqueta: 'El código de la ubicación', maximo: 30 })
  codigo: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 20 })
  @Parte('La zona')
  zona?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 20 })
  @Parte('El pasillo')
  pasillo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 20 })
  @Parte('El estante')
  estante?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 20 })
  @Parte('El nivel')
  nivel?: string | null;
}

/** Edición: cada campo que llega reemplaza al anterior. `activa: false` exige que no tenga stock. */
export class ActualizarUbicacionDto extends PartialType(CrearUbicacionDto) {
  @ApiPropertyOptional({
    description: 'Desactivarla exige que no tenga stock.',
  })
  @Booleano({ etiqueta: 'Activa' })
  activa?: boolean;
}

class UbicacionPanelDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'A-01' })
  codigo: string;

  @ApiProperty({ type: String, nullable: true })
  zona: string | null;

  @ApiProperty({ type: String, nullable: true })
  pasillo: string | null;

  @ApiProperty({ type: String, nullable: true })
  estante: string | null;

  @ApiProperty({ type: String, nullable: true })
  nivel: string | null;

  @ApiProperty()
  activa: boolean;

  @ApiProperty({
    example: 12,
    description: 'Unidades guardadas, de todos los formatos.',
  })
  stock: number;
}

class LugarDto {
  @ApiProperty({ example: '13101' })
  codigoCut: string;

  @ApiProperty({ example: 'Santiago' })
  nombre: string;
}

/** Una bodega del panel con sus ubicaciones (también las desactivadas) y su stock. */
export class BodegaPanelDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: 'Bodega central' })
  nombre: string;

  @ApiProperty({ example: 'Av. Matta 1234' })
  direccion: string;

  @ApiProperty({ enum: TIPOS })
  tipo: (typeof TIPOS_BODEGA)[keyof typeof TIPOS_BODEGA];

  @ApiProperty()
  abasteceVentaOnline: boolean;

  @ApiProperty()
  activa: boolean;

  @ApiProperty({
    description:
      'Desde aquí salen los despachos: origen de la cotización y de las OT (SCRUM-153).',
  })
  esDespacho: boolean;

  @ApiProperty({ type: LugarDto })
  comuna: LugarDto;

  @ApiProperty({ type: LugarDto })
  region: LugarDto;

  @ApiProperty({
    example: 40,
    description: 'Unidades en todas sus ubicaciones.',
  })
  stock: number;

  @ApiProperty({ type: [UbicacionPanelDto], description: 'Por código.' })
  ubicaciones: UbicacionPanelDto[];
}
