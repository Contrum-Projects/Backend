import type { PrismaService } from '../prisma/prisma.service.js';
import { RevocacionSesiones } from './revocacion-sesiones.js';

const SID = '5d2f9a1c-7b3e-4f60-8a91-c4e2d7f3b8a0';

describe('RevocacionSesiones', () => {
  let prisma: { sesion: { findUnique: ReturnType<typeof vi.fn> } };
  let revocacion: RevocacionSesiones;

  beforeEach(() => {
    prisma = { sesion: { findUnique: vi.fn() } };
    revocacion = new RevocacionSesiones(prisma as unknown as PrismaService);
  });

  it('E1-H3 · cierre de sesión: una sesión con fecha de revocación está revocada', async () => {
    prisma.sesion.findUnique.mockResolvedValue({ fechaRevocacion: new Date() });

    await expect(revocacion.estaRevocada(SID)).resolves.toBe(true);
    expect(prisma.sesion.findUnique).toHaveBeenCalledWith({
      where: { codigoPublico: SID },
      select: { fechaRevocacion: true },
    });
  });

  it('E1-H3 · cierre de sesión: una sesión abierta no está revocada', async () => {
    prisma.sesion.findUnique.mockResolvedValue({ fechaRevocacion: null });

    await expect(revocacion.estaRevocada(SID)).resolves.toBe(false);
  });

  it('E1-H3 · cierre de sesión: una sesión que no existe cuenta como revocada', async () => {
    prisma.sesion.findUnique.mockResolvedValue(null);

    await expect(revocacion.estaRevocada(SID)).resolves.toBe(true);
  });
});
