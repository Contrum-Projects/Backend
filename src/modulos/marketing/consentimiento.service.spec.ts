import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ConsentimientoService } from './consentimiento.service.js';

const CODIGO = '6f1c1b1e-0000-4000-8000-000000000001';
const FECHA = new Date('2026-11-04T15:00:00.000Z');

describe('ConsentimientoService', () => {
  let prisma: {
    usuario: {
      updateMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
  };
  let servicio: ConsentimientoService;

  beforeEach(() => {
    prisma = {
      usuario: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          aceptaMarketingEmail: true,
          fechaConsentimientoMarketing: FECHA,
        }),
      },
    };
    servicio = new ConsentimientoService(prisma as unknown as PrismaService);
  });

  it('E12-H2 · consentimiento en la cuenta: activar las ofertas guarda la preferencia y la fecha del consentimiento', async () => {
    const resultado = await servicio.actualizar(CODIGO, true);

    expect(prisma.usuario.updateMany).toHaveBeenCalledWith({
      where: { codigoPublico: CODIGO, aceptaMarketingEmail: false },
      data: {
        aceptaMarketingEmail: true,
        fechaConsentimientoMarketing: expect.any(Date) as Date,
      },
    });
    expect(resultado).toEqual({
      acepta: true,
      fechaConsentimiento: FECHA.toISOString(),
    });
  });

  it('E12-H2 · consentimiento en la cuenta: activarlo otra vez no cambia la fecha (solo actualiza si estaba desactivado)', async () => {
    prisma.usuario.updateMany.mockResolvedValue({ count: 0 });

    const resultado = await servicio.actualizar(CODIGO, true);

    expect(prisma.usuario.updateMany.mock.calls[0][0]).toMatchObject({
      where: { aceptaMarketingEmail: false },
    });
    expect(resultado.fechaConsentimiento).toBe(FECHA.toISOString());
  });

  it('E12-H2 · consentimiento en la cuenta: desactivarlo conserva la fecha del último consentimiento', async () => {
    prisma.usuario.findUnique.mockResolvedValue({
      aceptaMarketingEmail: false,
      fechaConsentimientoMarketing: FECHA,
    });

    const resultado = await servicio.actualizar(CODIGO, false);

    expect(prisma.usuario.updateMany).toHaveBeenCalledWith({
      where: { codigoPublico: CODIGO, aceptaMarketingEmail: true },
      data: { aceptaMarketingEmail: false },
    });
    expect(resultado).toEqual({
      acepta: false,
      fechaConsentimiento: FECHA.toISOString(),
    });
  });

  it('E12-H2 · consentimiento en la cuenta: una cuenta que nunca aceptó responde sin fecha', async () => {
    prisma.usuario.findUnique.mockResolvedValue({
      aceptaMarketingEmail: false,
      fechaConsentimientoMarketing: null,
    });

    await expect(servicio.actualizar(CODIGO, false)).resolves.toEqual({
      acepta: false,
      fechaConsentimiento: null,
    });
  });

  it('E12-H2 · una cuenta que ya no existe responde 404', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null);

    await expect(servicio.actualizar(CODIGO, true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
