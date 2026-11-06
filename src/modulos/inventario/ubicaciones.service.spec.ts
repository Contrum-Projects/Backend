import type { PrismaService } from '../../prisma/prisma.service.js';
import { UbicacionesService } from './ubicaciones.service.js';

describe('UbicacionesService', () => {
  it('E11 · solo ubicaciones activas de bodegas activas, por bodega y código', async () => {
    const filas = [
      { id: 3, codigo: 'A-01', bodega: { id: 1, nombre: 'Bodega principal' } },
    ];
    const findMany = vi.fn().mockResolvedValue(filas);
    const servicio = new UbicacionesService({
      ubicacion: { findMany },
    } as unknown as PrismaService);

    await expect(servicio.listarActivas()).resolves.toEqual(filas);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { activa: true, bodega: { activa: true } },
        select: {
          id: true,
          codigo: true,
          bodega: { select: { id: true, nombre: true } },
        },
      }),
    );
  });
});
