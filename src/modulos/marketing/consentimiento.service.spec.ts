import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ConsentimientoService } from './consentimiento.service.js';

const CODIGO = '6f1c1b1e-0000-4000-8000-000000000001';
const EMAIL = 'camila@correo.cl';
const FECHA = new Date('2026-11-04T15:00:00.000Z');

const crearPrisma = () => {
  const tx = {
    usuario: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({
        email: EMAIL,
        aceptaMarketingEmail: true,
        fechaConsentimientoMarketing: FECHA,
      }),
    },
    lead: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
};

describe('ConsentimientoService', () => {
  let prisma: ReturnType<typeof crearPrisma>['prisma'];
  let tx: ReturnType<typeof crearPrisma>['tx'];
  let servicio: ConsentimientoService;

  beforeEach(() => {
    ({ prisma, tx } = crearPrisma());
    servicio = new ConsentimientoService(prisma as unknown as PrismaService);
  });

  it('E12-H2 · consentimiento en la cuenta: activar las ofertas guarda la preferencia y la fecha del consentimiento', async () => {
    const resultado = await servicio.actualizar(CODIGO, true);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.usuario.updateMany).toHaveBeenCalledWith({
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

  it('E12-H2 · consentimiento en la cuenta: activarlas no reactiva la suscripción sin cuenta', async () => {
    await servicio.actualizar(CODIGO, true);

    expect(tx.lead.updateMany).not.toHaveBeenCalled();
  });

  it('E12-H2 · consentimiento en la cuenta: activarlo otra vez no cambia la fecha (solo actualiza si estaba desactivado)', async () => {
    tx.usuario.updateMany.mockResolvedValue({ count: 0 });

    const resultado = await servicio.actualizar(CODIGO, true);

    expect(tx.usuario.updateMany.mock.calls[0][0]).toMatchObject({
      where: { aceptaMarketingEmail: false },
    });
    expect(resultado.fechaConsentimiento).toBe(FECHA.toISOString());
  });

  it('E12-H2 · consentimiento en la cuenta: desactivarlo conserva la fecha del último consentimiento', async () => {
    tx.usuario.findUnique.mockResolvedValue({
      email: EMAIL,
      aceptaMarketingEmail: false,
      fechaConsentimientoMarketing: FECHA,
    });

    const resultado = await servicio.actualizar(CODIGO, false);

    expect(tx.usuario.updateMany).toHaveBeenCalledWith({
      where: { codigoPublico: CODIGO, aceptaMarketingEmail: true },
      data: { aceptaMarketingEmail: false },
    });
    expect(resultado).toEqual({
      acepta: false,
      fechaConsentimiento: FECHA.toISOString(),
    });
  });

  it('E12-H2 · consentimiento en la cuenta: desactivarlo da de baja también la suscripción sin cuenta de la misma dirección, en la misma transacción', async () => {
    await servicio.actualizar(CODIGO, false);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.lead.updateMany).toHaveBeenCalledWith({
      where: { email: EMAIL },
      data: { activo: false, fechaBaja: expect.any(Date) as Date },
    });
  });

  it('E12-H2 · consentimiento en la cuenta: una cuenta que nunca aceptó responde sin fecha', async () => {
    tx.usuario.findUnique.mockResolvedValue({
      email: EMAIL,
      aceptaMarketingEmail: false,
      fechaConsentimientoMarketing: null,
    });

    await expect(servicio.actualizar(CODIGO, false)).resolves.toEqual({
      acepta: false,
      fechaConsentimiento: null,
    });
  });

  it('E12-H2 · una cuenta que ya no existe responde 404 sin tocar suscripciones', async () => {
    tx.usuario.findUnique.mockResolvedValue(null);

    await expect(servicio.actualizar(CODIGO, false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.lead.updateMany).not.toHaveBeenCalled();
  });
});
