import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ReporteCarritosService } from './reporte-carritos.service.js';

interface Evento {
  usuarioId: number;
  fecha: Date;
}

const evento = (usuarioId: number, fecha: string): Evento => ({
  usuarioId,
  fecha: new Date(fecha),
});

describe('ReporteCarritosService', () => {
  let prisma: { $queryRaw: ReturnType<typeof vi.fn> };
  let servicio: ReporteCarritosService;

  /** La primera consulta trae los recordatorios y la segunda las compras pagadas. */
  const conEventos = (recordatorios: Evento[], compras: Evento[]) => {
    prisma.$queryRaw
      .mockResolvedValueOnce(recordatorios)
      .mockResolvedValueOnce(compras);
  };

  beforeEach(() => {
    prisma = { $queryRaw: vi.fn().mockResolvedValue([]) };
    servicio = new ReporteCarritosService(prisma as unknown as PrismaService);
  });

  it('E14-H3 · carritos por mes: devuelve por mes cuántos se abandonaron y cuántos terminaron en una compra pagada', async () => {
    conEventos(
      [
        // Cuenta 1: un abandono en octubre, recuperado; otro en noviembre
        evento(1, '2026-10-05T13:00:00Z'),
        evento(1, '2026-10-06T12:00:00Z'),
        evento(1, '2026-11-02T13:00:00Z'),
        // Cuenta 2: un abandono en noviembre, recuperado
        evento(2, '2026-11-03T13:00:00Z'),
      ],
      [evento(1, '2026-10-07T12:00:00Z'), evento(2, '2026-11-04T12:00:00Z')],
    );

    const reporte = await servicio.carritosPorMes('2026-10', '2026-11');

    expect(reporte).toEqual({
      desde: '2026-10',
      hasta: '2026-11',
      meses: [
        {
          mes: '2026-10',
          abandonados: 1,
          recuperados: 1,
          porcentajeRecuperados: 100,
        },
        {
          mes: '2026-11',
          abandonados: 2,
          recuperados: 1,
          porcentajeRecuperados: 50,
        },
      ],
      total: { abandonados: 3, recuperados: 2, porcentajeRecuperados: 67 },
    });
  });

  it('E14-H3 · carritos por mes: cada abandono cuenta en el mes de Chile de su primer recordatorio', async () => {
    // 31 oct a las 22:00 de Chile (UTC-3): en UTC ya es 1 de noviembre
    conEventos([evento(1, '2026-11-01T01:00:00Z')], []);

    const reporte = await servicio.carritosPorMes('2026-10', '2026-11');

    expect(reporte.meses).toEqual([
      {
        mes: '2026-10',
        abandonados: 1,
        recuperados: 0,
        porcentajeRecuperados: 0,
      },
      {
        mes: '2026-11',
        abandonados: 0,
        recuperados: 0,
        porcentajeRecuperados: null,
      },
    ]);
  });

  it('E14-H3 · carritos por mes: los abandonos de meses fuera del período no cuentan, aunque se lean para armar las series', async () => {
    conEventos(
      [evento(1, '2026-09-07T13:00:00Z'), evento(1, '2026-10-05T13:00:00Z')],
      [],
    );

    const reporte = await servicio.carritosPorMes('2026-10', '2026-10');

    expect(reporte.meses).toEqual([
      {
        mes: '2026-10',
        abandonados: 1,
        recuperados: 0,
        porcentajeRecuperados: 0,
      },
    ]);
    expect(reporte.total).toEqual({
      abandonados: 1,
      recuperados: 0,
      porcentajeRecuperados: 0,
    });
  });

  it('E14-H3 · carritos por mes: sin abandonos devuelve cada mes en cero, también al cruzar el año', async () => {
    const reporte = await servicio.carritosPorMes('2026-11', '2027-02');

    expect(reporte.meses.map((fila) => fila.mes)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(reporte.total).toEqual({
      abandonados: 0,
      recuperados: 0,
      porcentajeRecuperados: null,
    });
  });

  it('E14-H3 · carritos por mes: el mes hasta anterior al desde o más de 24 meses responden 400 sin consultar', async () => {
    await expect(
      servicio.carritosPorMes('2026-11', '2026-10'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      servicio.carritosPorMes('2025-01', '2027-01'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();

    // 24 meses justos sí se aceptan
    await expect(
      servicio.carritosPorMes('2025-01', '2026-12'),
    ).resolves.toMatchObject({ desde: '2025-01', hasta: '2026-12' });
  });
});
