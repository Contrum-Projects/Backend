import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { BajasService } from './bajas.service.js';

describe('BajasService', () => {
  let tx: {
    usuario: {
      count: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    lead: {
      count: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
  let prisma: { $transaction: ReturnType<typeof vi.fn> };
  let servicio: BajasService;

  beforeEach(() => {
    tx = {
      usuario: {
        count: vi.fn().mockResolvedValue(1),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      lead: {
        count: vi.fn().mockResolvedValue(1),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma = {
      $transaction: vi.fn((trabajo: (cliente: typeof tx) => unknown) =>
        trabajo(tx),
      ),
    };
    servicio = new BajasService(prisma as unknown as PrismaService);
  });

  it('E12-H2 · baja desde el panel: deja sin publicidad la cuenta y la suscripción con ese correo, en una transacción', async () => {
    await expect(servicio.darDeBaja('camila@correo.cl')).resolves.toEqual({
      email: 'camila@correo.cl',
      cuenta: true,
      suscripcion: true,
      mensaje: 'Listo. camila@correo.cl ya no recibirá publicidad.',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.lead.updateMany).toHaveBeenCalledWith({
      where: { email: 'camila@correo.cl' },
      data: { activo: false, fechaBaja: expect.any(Date) as Date },
    });
    expect(tx.usuario.updateMany).toHaveBeenCalledWith({
      where: { email: 'camila@correo.cl', aceptaMarketingEmail: true },
      data: { aceptaMarketingEmail: false },
    });
  });

  it('E12-H2 · baja desde el panel: con solo una suscripción sin cuenta, la da de baja e informa que no hay cuenta', async () => {
    tx.usuario.count.mockResolvedValue(0);

    await expect(servicio.darDeBaja('camila@correo.cl')).resolves.toMatchObject(
      { cuenta: false, suscripcion: true },
    );
    expect(tx.lead.updateMany).toHaveBeenCalled();
  });

  it('E12-H2 · baja desde el panel: un correo sin cuenta ni suscripción responde 404 sin tocar nada', async () => {
    tx.usuario.count.mockResolvedValue(0);
    tx.lead.count.mockResolvedValue(0);

    await expect(servicio.darDeBaja('nadie@correo.cl')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.lead.updateMany).not.toHaveBeenCalled();
    expect(tx.usuario.updateMany).not.toHaveBeenCalled();
  });
});
