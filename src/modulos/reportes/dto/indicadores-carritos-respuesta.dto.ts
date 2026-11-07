import { ApiProperty } from '@nestjs/swagger';
import { ESTADOS_OBJETIVO } from '../../../common/dominio/valores.js';

/**
 * Respuestas de `GET /api/reportes/indicadores` (E14-H1) y `GET /api/reportes/carritos-abandonados`
 * (E14-H3), declaradas para el Swagger (SCRUM-150).
 */

class IndicadorDto {
  @ApiProperty({ enum: ['OE1', 'OE2', 'OE3'] })
  codigo: 'OE1' | 'OE2' | 'OE3';

  @ApiProperty({ example: 'Profesionales verificados que compran' })
  nombre: string;

  @ApiProperty({ example: 30, description: 'Meta en porcentaje.' })
  meta: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 42.9,
    description: 'Con un decimal; `null` sin nada que medir en el período.',
  })
  porcentaje: number | null;

  @ApiProperty({
    example: 3,
    description: 'Lo que cumple el objetivo, de `total`.',
  })
  cumplidos: number;

  @ApiProperty({ example: 7 })
  total: number;

  @ApiProperty()
  sinDatos: boolean;

  @ApiProperty({
    enum: Object.values(ESTADOS_OBJETIVO),
    description:
      'Frente a la meta: `sobre-la-meta` si la alcanza o la supera, `bajo-la-meta` si no, `sin-datos` sin nada que medir.',
  })
  estado: (typeof ESTADOS_OBJETIVO)[keyof typeof ESTADOS_OBJETIVO];
}

export class ReporteIndicadoresRespuestaDto {
  @ApiProperty({ example: '2026-11-01', format: 'date' })
  desde: string;

  @ApiProperty({ example: '2026-11-30', format: 'date' })
  hasta: string;

  @ApiProperty({ type: [IndicadorDto] })
  indicadores: IndicadorDto[];
}

class CarritosDelMesDto {
  @ApiProperty({
    example: '2026-11',
    description: 'AAAA-MM, en hora de Chile.',
  })
  mes: string;

  @ApiProperty({ example: 12 })
  abandonados: number;

  @ApiProperty({
    example: 3,
    description:
      'De los abandonados ese mes, cuántos terminaron en una compra pagada.',
  })
  recuperados: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 25,
    description:
      'Recuperados sobre abandonados, de 0 a 100 al entero; `null` sin abandonos.',
  })
  porcentajeRecuperados: number | null;
}

class TotalCarritosDto {
  @ApiProperty({ example: 30 })
  abandonados: number;

  @ApiProperty({ example: 6 })
  recuperados: number;

  @ApiProperty({ type: Number, nullable: true, example: 20 })
  porcentajeRecuperados: number | null;
}

export class ReporteCarritosRespuestaDto {
  @ApiProperty({ example: '2026-01' })
  desde: string;

  @ApiProperty({ example: '2026-12' })
  hasta: string;

  @ApiProperty({ type: [CarritosDelMesDto] })
  meses: CarritosDelMesDto[];

  @ApiProperty({ type: TotalCarritosDto })
  total: TotalCarritosDto;
}
