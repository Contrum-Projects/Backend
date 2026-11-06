import { ConflictException, NotFoundException } from '@nestjs/common';
import { TIPOS_CAMPANA } from '../../common/dominio/valores.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ReporteCampanasService } from './reporte-campanas.service.js';

const ENVIO = new Date('2026-11-05T15:00:00Z');

describe('ReporteCampanasService', () => {
  let prisma: {
    campana: { findUnique: ReturnType<typeof vi.fn> };
    $queryRaw: ReturnType<typeof vi.fn>;
  };
  let servicio: ReporteCampanasService;

  beforeEach(() => {
    prisma = {
      campana: {
        findUnique: vi.fn().mockResolvedValue({
          id: 7,
          tipo: TIPOS_CAMPANA.ENVIO_UNICO,
          asunto: 'Ofertas de noviembre',
          fechaEncolado: ENVIO,
        }),
      },
      $queryRaw: vi.fn().mockResolvedValue([
        {
          total: 10n,
          pendientes: 1n,
          enviados: 5n,
          abiertos: 4n,
          clics: 2n,
          rebotados: 1n,
          cancelados: 2n,
          fallidos: 1n,
        },
      ]),
    };
    servicio = new ReporteCampanasService(prisma as unknown as PrismaService);
  });

  it('E14-H3 · resultado de una campaña: devuelve los correos enviados, abiertos, con clic, rebotados, cancelados y fallidos', async () => {
    await expect(servicio.resultado(7)).resolves.toEqual({
      id: 7,
      tipo: TIPOS_CAMPANA.ENVIO_UNICO,
      asunto: 'Ofertas de noviembre',
      fechaEnvio: ENVIO,
      envios: {
        total: 10,
        pendientes: 1,
        enviados: 5,
        abiertos: 4,
        clics: 2,
        rebotados: 1,
        cancelados: 2,
        fallidos: 1,
      },
    });
  });

  it('E14-H3 · resultado de una campaña: el saludo de cumpleaños no tiene fecha de envío y también tiene resultado', async () => {
    prisma.campana.findUnique.mockResolvedValue({
      id: 3,
      tipo: TIPOS_CAMPANA.CUMPLEANOS,
      asunto: '¡Feliz cumpleaños!',
      fechaEncolado: null,
    });

    const resultado = await servicio.resultado(3);

    expect(resultado.fechaEnvio).toBeNull();
    expect(resultado.envios.enviados).toBe(5);
  });

  it('E14-H3 · resultado de una campaña: sin correos todo sale en cero', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        total: 0n,
        pendientes: 0n,
        enviados: 0n,
        abiertos: 0n,
        clics: 0n,
        rebotados: 0n,
        cancelados: 0n,
        fallidos: 0n,
      },
    ]);

    const { envios } = await servicio.resultado(7);

    expect(Object.values(envios).every((valor) => valor === 0)).toBe(true);
  });

  it('E14-H3 · resultado de una campaña: un borrador aún no enviado responde 409', async () => {
    prisma.campana.findUnique.mockResolvedValue({
      id: 7,
      tipo: TIPOS_CAMPANA.ENVIO_UNICO,
      asunto: 'Borrador',
      fechaEncolado: null,
    });

    await expect(servicio.resultado(7)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('E14-H3 · resultado de una campaña: una campaña que no existe responde 404', async () => {
    prisma.campana.findUnique.mockResolvedValue(null);

    await expect(servicio.resultado(99)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
