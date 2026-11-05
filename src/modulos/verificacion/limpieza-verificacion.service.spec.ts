import type { AlmacenArchivos } from '../../almacen/almacen-archivos.js';
import { AlmacenNoConfigurado } from '../../almacen/almacen-r2.js';
import { ESTADOS_SOLICITUD } from '../../common/dominio/valores.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { LimpiezaVerificacionService } from './limpieza-verificacion.service.js';

const AHORA = new Date('2026-12-05T15:00:00.000Z');
const LIMITE = new Date('2026-11-05T15:00:00.000Z');

interface Antecedente {
  id: number;
  ubicacionArchivo: string;
}

const antecedente = (id: number): Antecedente => ({
  id,
  ubicacionArchivo: `verificaciones/7/archivo-${id}`,
});

const crear = (
  lotes: Antecedente[][],
  eliminar = vi.fn().mockResolvedValue(undefined),
) => {
  const findMany = vi.fn();
  for (const lote of lotes) findMany.mockResolvedValueOnce(lote);
  findMany.mockResolvedValue([]);
  const prisma = {
    antecedente: {
      findMany,
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const servicio = new LimpiezaVerificacionService(
    prisma as unknown as PrismaService,
    { eliminar } as unknown as AlmacenArchivos,
  );
  return { servicio, prisma, eliminar };
};

describe('LimpiezaVerificacionService (E10-H6)', () => {
  it('E10-H6 · CA1 archivos eliminados: borra cada archivo del almacén y registra la fecha de eliminación, sin tocar la solicitud', async () => {
    const { servicio, prisma, eliminar } = crear([
      [antecedente(4), antecedente(9)],
    ]);

    const resumen = await servicio.eliminarArchivosVencidos(AHORA);

    expect(eliminar).toHaveBeenCalledWith('verificaciones/7/archivo-4');
    expect(eliminar).toHaveBeenCalledWith('verificaciones/7/archivo-9');
    // Solo la fecha de eliminación: tipo, nombre, hash y la solicitud con su resolución y la
    // consulta al SII se conservan
    expect(prisma.antecedente.updateMany).toHaveBeenCalledWith({
      where: { id: 4, fechaEliminacionArchivo: null },
      data: { fechaEliminacionArchivo: AHORA },
    });
    expect(prisma.antecedente.updateMany).toHaveBeenCalledWith({
      where: { id: 9, fechaEliminacionArchivo: null },
      data: { fechaEliminacionArchivo: AHORA },
    });
    expect(resumen).toEqual({ eliminados: 2, fallidos: 0 });
  });

  it('E10-H6 · CA1 y CA2: solo busca archivos sin eliminar de solicitudes aprobadas o rechazadas hace 30 días o más', async () => {
    const { servicio, prisma } = crear([]);

    await servicio.eliminarArchivosVencidos(AHORA);

    expect(prisma.antecedente.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { gt: 0 },
          fechaEliminacionArchivo: null,
          solicitud: {
            estado: {
              in: [ESTADOS_SOLICITUD.APROBADA, ESTADOS_SOLICITUD.RECHAZADA],
            },
            fechaResolucion: { lte: LIMITE },
          },
        },
        orderBy: { id: 'asc' },
      }),
    );
  });

  it('E10-H6 · CA2 solicitud reciente: sin archivos vencidos no borra nada', async () => {
    const { servicio, prisma, eliminar } = crear([]);

    const resumen = await servicio.eliminarArchivosVencidos(AHORA);

    expect(eliminar).not.toHaveBeenCalled();
    expect(prisma.antecedente.updateMany).not.toHaveBeenCalled();
    expect(resumen).toEqual({ eliminados: 0, fallidos: 0 });
  });

  it('recorre los lotes siguientes desde el último id', async () => {
    const lleno = Array.from({ length: 100 }, (_, i) => antecedente(i + 1));
    const { servicio, prisma } = crear([lleno, [antecedente(150)]]);

    const resumen = await servicio.eliminarArchivosVencidos(AHORA);

    expect(prisma.antecedente.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.antecedente.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { gt: 100 } }) as unknown,
      }),
    );
    expect(resumen.eliminados).toBe(101);
  });

  it('si el almacén falla con un archivo, no registra su eliminación y sigue con los demás', async () => {
    const eliminar = vi
      .fn()
      .mockRejectedValueOnce(new Error('R2 no responde'))
      .mockResolvedValue(undefined);
    const { servicio, prisma } = crear(
      [[antecedente(4), antecedente(9)]],
      eliminar,
    );

    const resumen = await servicio.eliminarArchivosVencidos(AHORA);

    expect(prisma.antecedente.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.antecedente.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9, fechaEliminacionArchivo: null },
      }),
    );
    expect(resumen).toEqual({ eliminados: 1, fallidos: 1 });
  });

  it('si otra pasada ya registró la eliminación, no la cuenta dos veces', async () => {
    const { servicio, prisma } = crear([[antecedente(4)]]);
    prisma.antecedente.updateMany.mockResolvedValue({ count: 0 });

    const resumen = await servicio.eliminarArchivosVencidos(AHORA);

    expect(resumen).toEqual({ eliminados: 0, fallidos: 0 });
  });

  it('sin almacén configurado no marca nada como eliminado: los archivos seguirían en R2', async () => {
    const prisma = {
      antecedente: { findMany: vi.fn(), updateMany: vi.fn() },
    };
    const servicio = new LimpiezaVerificacionService(
      prisma as unknown as PrismaService,
      new AlmacenNoConfigurado(),
    );

    const resumen = await servicio.eliminarArchivosVencidos(AHORA);

    expect(prisma.antecedente.findMany).not.toHaveBeenCalled();
    expect(prisma.antecedente.updateMany).not.toHaveBeenCalled();
    expect(resumen).toEqual({ eliminados: 0, fallidos: 0 });
  });
});
