import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  aIndicador,
  ReporteIndicadoresService,
} from './reporte-indicadores.service.js';

/** El SQL que armó la consulta, para revisar qué filtra: los valores van como parámetros. */
const sqlDe = (llamada: unknown[]): string =>
  (llamada[0] as TemplateStringsArray).join('?');

describe('ReporteIndicadoresService', () => {
  let prisma: { $queryRaw: ReturnType<typeof vi.fn> };
  let servicio: ReporteIndicadoresService;

  beforeEach(() => {
    prisma = { $queryRaw: vi.fn().mockResolvedValue([]) };
    servicio = new ReporteIndicadoresService(
      prisma as unknown as PrismaService,
    );
  });

  it('E14-H1 · CA1 indicadores con datos: devuelve cada objetivo como porcentaje junto a su meta (30 %, 70 % y 80 %)', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ total: 7n, cumplidos: 3n }])
      .mockResolvedValueOnce([{ total: 10n, cumplidos: 7n }])
      .mockResolvedValueOnce([{ total: 4n, cumplidos: 4n }]);

    const reporte = await servicio.indicadores('2026-11-01', '2026-11-30');

    expect(reporte).toEqual({
      desde: '2026-11-01',
      hasta: '2026-11-30',
      indicadores: [
        {
          codigo: 'OE1',
          nombre: 'Profesionales verificados que compran',
          meta: 30,
          porcentaje: 42.9,
          cumplidos: 3,
          total: 7,
          sinDatos: false,
        },
        {
          codigo: 'OE2',
          nombre: 'Solicitudes resueltas en 48 horas',
          meta: 70,
          porcentaje: 70,
          cumplidos: 7,
          total: 10,
          sinDatos: false,
        },
        {
          codigo: 'OE3',
          nombre: 'Descripciones hechas con IA',
          meta: 80,
          porcentaje: 100,
          cumplidos: 4,
          total: 4,
          sinDatos: false,
        },
      ],
    });
  });

  it('E14-H1 · CA2 período sin datos: cada indicador sin registros indica que no hay datos, sin porcentaje', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ total: 0n, cumplidos: 0n }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 2n, cumplidos: 0n }]);

    const { indicadores } = await servicio.indicadores(
      '2026-11-01',
      '2026-11-30',
    );

    expect(
      indicadores.map((i) => [i.codigo, i.porcentaje, i.sinDatos]),
    ).toEqual([
      ['OE1', null, true],
      ['OE2', null, true],
      // Con datos pero ninguno cumple: 0 %, no «sin datos»
      ['OE3', 0, false],
    ]);
  });

  it('E14-H1 · el porcentaje va con un decimal', () => {
    expect(aIndicador('OE1', { total: 3n, cumplidos: 1n }).porcentaje).toBe(
      33.3,
    );
    expect(aIndicador('OE1', { total: 3n, cumplidos: 2n }).porcentaje).toBe(
      66.7,
    );
  });

  it('E14-H1 · OE1: cuenta las aprobadas en el período y las compras pagadas desde la aprobación', async () => {
    await servicio.indicadores('2026-11-01', '2026-11-30');

    const [llamada] = prisma.$queryRaw.mock.calls;
    const sql = sqlDe(llamada);
    expect(sql).toContain('FROM solicitud_verificacion');
    expect(sql).toContain('p.fecha_pedido >= a.fecha_aprobacion');
    expect(sql).toContain('p.estado_actual <> ALL');
    expect(llamada).toContain('aprobada');
    expect(llamada).toContainEqual(['pendiente_pago', 'cancelado']);
  });

  it('E14-H1 · OE2: mide desde la presentación, con plazo de 48 h, y deja fuera las que aún están dentro de su plazo', async () => {
    const ahora = new Date('2026-11-30T12:00:00Z');

    await servicio.indicadores('2026-11-01', '2026-11-30', ahora);

    const llamada = prisma.$queryRaw.mock.calls[1];
    const sql = sqlDe(llamada);
    expect(sql).toContain('s.fecha_resolucion - s.fecha_solicitud <=');
    expect(sql).toContain('OR s.fecha_solicitud <=');
    expect(llamada).toContain(48);
    expect(llamada).toContain(ahora);
    expect(llamada).toContainEqual(['aprobada', 'rechazada']);
  });

  it('E14-H1 · OE3: cuenta como hechas con IA las aceptadas tal cual y las corregidas', async () => {
    await servicio.indicadores('2026-11-01', '2026-11-30');

    const llamada = prisma.$queryRaw.mock.calls[2];
    expect(sqlDe(llamada)).toContain('FROM producto');
    expect(llamada).toContainEqual(['ia', 'ia_editada']);
  });

  it('E14-H1 · período inválido: hasta antes de desde o más de 366 días responden 400 sin consultar', async () => {
    await expect(
      servicio.indicadores('2026-11-30', '2026-11-01'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      servicio.indicadores('2025-01-01', '2026-01-02'),
    ).rejects.toBeInstanceOf(BadRequestException);
    // El año 0 no existe en PostgreSQL: 400, no un error de la base
    await expect(
      servicio.indicadores('0000-01-01', '0000-01-02'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
