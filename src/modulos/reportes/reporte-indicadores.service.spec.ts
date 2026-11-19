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

  it('E14-H1 · CA1 indicadores con datos: devuelve cada objetivo como porcentaje junto a su meta (20 %, 80 % y 30 %)', async () => {
    prisma.$queryRaw
      // OE1: de $100.000 a $125.000, +25 %
      .mockResolvedValueOnce([{ total: 100_000n, cumplidos: 125_000n }])
      // OE2: de 10 quiebres a 1, -90 %
      .mockResolvedValueOnce([{ total: 10n, cumplidos: 1n }])
      // OE3: 3 de 7 pedidos fuera de la zona local
      .mockResolvedValueOnce([{ total: 7n, cumplidos: 3n }]);

    const reporte = await servicio.indicadores('2026-11-01', '2026-11-30');

    expect(reporte).toEqual({
      desde: '2026-11-01',
      hasta: '2026-11-30',
      indicadores: [
        {
          codigo: 'OE1',
          nombre: 'Facturación digital',
          meta: 20,
          porcentaje: 25,
          cumplidos: 125_000,
          total: 100_000,
          sinDatos: false,
          estado: 'sobre-la-meta',
        },
        {
          codigo: 'OE2',
          nombre: 'Quiebres de stock',
          meta: 80,
          porcentaje: 90,
          cumplidos: 1,
          total: 10,
          sinDatos: false,
          estado: 'sobre-la-meta',
        },
        {
          codigo: 'OE3',
          nombre: 'Alcance territorial',
          meta: 30,
          porcentaje: 42.9,
          cumplidos: 3,
          total: 7,
          sinDatos: false,
          estado: 'sobre-la-meta',
        },
      ],
    });
  });

  it('E14-H1 · CA2 período sin datos: cada indicador sin registros indica que no hay datos, sin porcentaje', async () => {
    prisma.$queryRaw
      // Sin ventas en el período anterior no hay con qué comparar
      .mockResolvedValueOnce([{ total: 0n, cumplidos: 50_000n }])
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
    expect(aIndicador('OE3', { total: 3n, cumplidos: 1n }).porcentaje).toBe(
      33.3,
    );
    expect(aIndicador('OE3', { total: 3n, cumplidos: 2n }).porcentaje).toBe(
      66.7,
    );
  });

  it('E14-H1 · OE1: si las ventas bajan, el crecimiento es negativo y queda bajo la meta', () => {
    expect(
      aIndicador('OE1', { total: 200_000n, cumplidos: 150_000n }),
    ).toMatchObject({ porcentaje: -25, estado: 'bajo-la-meta' });
  });

  it('E14-H1 · OE2: si los quiebres suben, la reducción es negativa y queda bajo la meta', () => {
    expect(aIndicador('OE2', { total: 4n, cumplidos: 6n })).toMatchObject({
      porcentaje: -50,
      estado: 'bajo-la-meta',
    });
    // Sin quiebres en el período, con quiebres antes: reducción de 100 %
    expect(aIndicador('OE2', { total: 4n, cumplidos: 0n })).toMatchObject({
      porcentaje: 100,
      estado: 'sobre-la-meta',
    });
  });

  it('E14-H1 · OE1: suma el monto de los pedidos pagados del período y del anterior de igual largo', async () => {
    await servicio.indicadores('2026-11-01', '2026-11-30');

    const [llamada] = prisma.$queryRaw.mock.calls;
    const sql = sqlDe(llamada);
    expect(sql).toContain('SUM(p.monto_total)');
    expect(sql).toContain('AS inicio_anterior');
    expect(sql).toContain('p.estado_actual <> ALL');
    expect(llamada).toContainEqual(['pendiente_pago', 'cancelado']);
  });

  it('E14-H1 · OE2: reconstruye el saldo de cada formato y cuenta cuándo pasa de tener stock a 0', async () => {
    await servicio.indicadores('2026-11-01', '2026-11-30');

    const llamada = prisma.$queryRaw.mock.calls[1];
    const sql = sqlDe(llamada);
    expect(sql).toContain('FROM movimiento_inventario');
    expect(sql).toContain('PARTITION BY m.id_formato');
    expect(sql).toContain('c.saldo <= 0');
    expect(sql).toContain('c.saldo_previo > 0');
    expect(llamada).toContainEqual(['entrada', 'ajuste_positivo', 'reingreso']);
    expect(llamada).toContainEqual([
      'venta',
      'merma_vencimiento',
      'merma_dano',
      'consumo_peluqueria',
      'ajuste_negativo',
    ]);
  });

  it('E14-H1 · OE3: cuenta los despachos fuera de Talcahuano y sus comunas aledañas', async () => {
    await servicio.indicadores('2026-11-01', '2026-11-30');

    const llamada = prisma.$queryRaw.mock.calls[2];
    const sql = sqlDe(llamada);
    expect(sql).toContain('LEFT JOIN envio');
    expect(sql).toContain('c.codigo_cut IS NOT NULL');
    expect(llamada).toContainEqual([
      '08101',
      '08103',
      '08107',
      '08108',
      '08110',
      '08112',
    ]);
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

  describe('estado frente a la meta (SCRUM-150)', () => {
    it('E14-H1 · alcanzar la meta cuenta como sobre la meta; sin total, sin datos', () => {
      // OE3 tiene meta 30: 3 de 10 la alcanza; 2.996 de 10.000 (29,96 %) no
      expect(aIndicador('OE3', { total: 10n, cumplidos: 3n }).estado).toBe(
        'sobre-la-meta',
      );
      expect(
        aIndicador('OE3', { total: 10_000n, cumplidos: 2_996n }).estado,
      ).toBe('bajo-la-meta');
      // OE1 tiene meta 20: de 100 a 120 la alcanza justo
      expect(aIndicador('OE1', { total: 100n, cumplidos: 120n }).estado).toBe(
        'sobre-la-meta',
      );
      expect(aIndicador('OE1', { total: 0n, cumplidos: 0n }).estado).toBe(
        'sin-datos',
      );
    });
  });
});
