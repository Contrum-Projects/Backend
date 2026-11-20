import { ApiProperty } from '@nestjs/swagger';
import { ORIGENES_ERROR } from '../../../common/dominio/valores.js';
import type { OrigenError } from '../registro-errores.service.js';

class CuentaDelErrorDto {
  @ApiProperty({ format: 'uuid' })
  codigoPublico!: string;

  @ApiProperty({ example: 'Andrea Soto' })
  nombre!: string;

  @ApiProperty({ example: 'andrea@correo.cl' })
  email!: string;
}

/** Un error del registro, para el panel (SCRUM-168). */
export class RegistroErrorDto {
  @ApiProperty({ example: '3f1c2b9e-8a7d-4e0b-9a51-2c4d6e8f0a1b' })
  codigoSeguimiento!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  fechaHora!: Date;

  @ApiProperty({ enum: Object.values(ORIGENES_ERROR) })
  origen!: OrigenError;

  @ApiProperty({
    example: 'GenerarOtService.generar',
    description: 'Dónde falló: clase y método del backend, o la pantalla.',
  })
  componente!: string;

  @ApiProperty({ type: String, nullable: true, example: 'POST' })
  metodo!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '/api/pedidos/BB50C63834F3/estado',
  })
  ruta!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 500 })
  estadoHttp!: number | null;

  @ApiProperty({ example: 'TypeError' })
  tipoError!: string;

  @ApiProperty({
    example: "Cannot read properties of undefined (reading 'id')",
  })
  mensaje!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Solo las líneas de la pila (`at …`).',
  })
  traza!: string | null;

  @ApiProperty({
    type: CuentaDelErrorDto,
    nullable: true,
    description: 'La cuenta con sesión cuando ocurrió, si había.',
  })
  cuenta!: CuentaDelErrorDto | null;
}

class ConteosRegistroErroresDto {
  @ApiProperty({ example: 12 })
  todos!: number;

  @ApiProperty({ example: 7 })
  api!: number;

  @ApiProperty({ example: 4 })
  navegador!: number;

  @ApiProperty({ example: 1 })
  servidorWeb!: number;
}

/** Página del registro de errores (SCRUM-168). */
export class ListadoRegistroErroresDto {
  @ApiProperty({ type: [RegistroErrorDto] })
  items!: RegistroErrorDto[];

  @ApiProperty({ example: 12 })
  total!: number;

  @ApiProperty({ example: 1 })
  pagina!: number;

  @ApiProperty({ example: 20 })
  limite!: number;

  @ApiProperty({
    type: ConteosRegistroErroresDto,
    description:
      'Errores de cada origen con la búsqueda y las fechas aplicadas, sin el filtro de origen.',
  })
  conteos!: ConteosRegistroErroresDto;

  @ApiProperty({
    example: 90,
    description: 'Días que se guarda cada error antes de borrarse.',
  })
  diasRetencion!: number;
}
