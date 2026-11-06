import { ApiProperty } from '@nestjs/swagger';
import { TIPOS_DESTINATARIO_CAMPANA } from '../../../common/dominio/valores.js';
import type { TipoDestinatario } from '../../marketing/segmento-campana.js';

/** El segmento con que salió una campaña (siempre con las tres listas, aunque vengan vacías). */
export class SegmentoGuardadoDto {
  @ApiProperty({
    enum: Object.values(TIPOS_DESTINATARIO_CAMPANA),
    isArray: true,
    example: [TIPOS_DESTINATARIO_CAMPANA.PROFESIONAL],
  })
  tipos: TipoDestinatario[];

  @ApiProperty({ type: [Number], example: [3] })
  categorias: number[];

  @ApiProperty({ type: [Number], example: [] })
  marcas: number[];
}

/** Una fila de «Resultados de campañas» (E14-H3, SCRUM-150). */
export class FilaReporteCampanaDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 12,
    description:
      'Id de la campaña. `null` en el saludo de cumpleaños por defecto, que no tiene fila.',
  })
  id: number | null;

  @ApiProperty({
    example: 'Nueva línea reparadora',
    description: 'Asunto de la campaña, o «Saludo de cumpleaños».',
  })
  nombre: string;

  @ApiProperty({
    example: false,
    description: 'El saludo de cumpleaños: sus correos de un mes, en una fila.',
  })
  automatica: boolean;

  @ApiProperty({
    example: '2026-11-04T15:30:00.000Z',
    description:
      'Campaña: cuándo se confirmó el envío (ISO 8601). Automática: el mes (AAAA-MM, hora de Chile).',
  })
  fecha: string;

  @ApiProperty({
    type: SegmentoGuardadoDto,
    nullable: true,
    description: '`null` en el saludo de cumpleaños.',
  })
  segmento: SegmentoGuardadoDto | null;

  @ApiProperty({ example: 120, description: 'Correos que salieron.' })
  enviados: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 41,
    description:
      'De los enviados, cuántos se abrieron (0 a 100, sin decimales). `null` si no salió ninguno.',
  })
  porcentajeAbiertos: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 9,
    description:
      'De los enviados, cuántos tuvieron un clic (0 a 100, sin decimales). `null` si no salió ninguno.',
  })
  porcentajeClic: number | null;

  @ApiProperty({ example: 2 })
  rebotados: number;

  @ApiProperty({
    example: 1,
    description:
      'No salieron porque la persona ya no aceptaba publicidad al enviar (E12-H2).',
  })
  cancelados: number;

  @ApiProperty({ example: 0 })
  fallidos: number;
}

/** Respuesta de `GET /api/reportes/campanas?desde&hasta`. */
export class ReportePeriodoCampanasDto {
  @ApiProperty({ example: '2026-11-01', format: 'date' })
  desde: string;

  @ApiProperty({ example: '2026-11-30', format: 'date' })
  hasta: string;

  @ApiProperty({
    type: [FilaReporteCampanaDto],
    description: 'Las más recientes primero.',
  })
  campanas: FilaReporteCampanaDto[];
}
