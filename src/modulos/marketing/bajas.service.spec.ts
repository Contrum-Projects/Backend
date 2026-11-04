import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { BajasService, MENSAJE_BAJA } from './bajas.service.js';
import type { FirmaBaja } from './firma-baja.js';

describe('BajasService', () => {
  let prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    lead: { updateMany: ReturnType<typeof vi.fn> };
    usuario: { updateMany: ReturnType<typeof vi.fn> };
  };
  let firma: { verificar: ReturnType<typeof vi.fn> };
  let servicio: BajasService;

  beforeEach(() => {
    prisma = {
      $transaction: vi.fn((operaciones: Promise<unknown>[]) =>
        Promise.all(operaciones),
      ),
      lead: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      usuario: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    firma = { verificar: vi.fn().mockReturnValue('camila@correo.cl') };
    servicio = new BajasService(
      prisma as unknown as PrismaService,
      firma as unknown as FirmaBaja,
    );
  });

  it('E12-H2 · baja desde un correo: deja de enviar publicidad a la dirección, sea suscriptor o cuenta, en una transacción', async () => {
    await expect(servicio.darDeBaja('token')).resolves.toEqual({
      mensaje: MENSAJE_BAJA,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.lead.updateMany).toHaveBeenCalledWith({
      where: { email: 'camila@correo.cl' },
      data: { activo: false, fechaBaja: expect.any(Date) as Date },
    });
    expect(prisma.usuario.updateMany).toHaveBeenCalledWith({
      where: { email: 'camila@correo.cl', aceptaMarketingEmail: true },
      data: { aceptaMarketingEmail: false },
    });
  });

  it('E12-H2 · baja desde un correo: repetirla o usar una dirección sin cuenta ni suscripción responde lo mismo', async () => {
    prisma.lead.updateMany.mockResolvedValue({ count: 0 });
    prisma.usuario.updateMany.mockResolvedValue({ count: 0 });

    await expect(servicio.darDeBaja('token')).resolves.toEqual({
      mensaje: MENSAJE_BAJA,
    });
  });

  it('E12-H2 · baja desde un correo: un enlace con firma inválida responde 400 sin tocar nada (RNF-08)', async () => {
    firma.verificar.mockReturnValue(null);

    await expect(servicio.darDeBaja('falso')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
