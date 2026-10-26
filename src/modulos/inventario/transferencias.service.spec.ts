import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CrearTransferenciaDto } from './dto/crear-transferencia.dto.js';
import { TransferenciasService } from './transferencias.service.js';

const FECHA = new Date('2026-10-25T15:00:00Z');

const ubicacion = (id: number, activa = true) => ({
  id,
  codigo: `GONDOLA-${id}`,
  activa,
  bodega: { nombre: 'Tienda', activa: true },
});

const crearPrisma = () => {
  // Registra en qué orden se tocan las existencias: descuento (updateMany) y suma ($executeRaw)
  const orden: string[] = [];
  const tx = {
    usuario: { findUnique: vi.fn().mockResolvedValue({ id: 7 }) },
    formatoProducto: { findUnique: vi.fn().mockResolvedValue({ id: 11 }) },
    ubicacion: {
      findUnique: vi.fn(({ where }: { where: { id: number } }) =>
        Promise.resolve(ubicacion(where.id)),
      ),
    },
    $executeRaw: vi.fn(() => {
      orden.push('sumar');
      return Promise.resolve(1);
    }),
    existencia: {
      updateMany: vi.fn(() => {
        orden.push('descontar');
        return Promise.resolve({ count: 1 });
      }),
      findUnique: vi.fn(
        ({
          where,
        }: {
          where: { formatoId_ubicacionId: { ubicacionId: number } };
        }) =>
          Promise.resolve({
            cantidad: where.formatoId_ubicacionId.ubicacionId === 1 ? 5 : 15,
          }),
      ),
    },
    movimientoInventario: {
      create: vi.fn().mockResolvedValue({ id: 900, fechaHora: FECHA }),
    },
  };
  return {
    tx,
    orden,
    $transaction: vi.fn((fn: (cliente: typeof tx) => unknown) => fn(tx)),
  };
};

const dtoBase = () =>
  ({
    formatoId: 11,
    ubicacionOrigenId: 1,
    ubicacionDestinoId: 2,
    cantidad: 5,
  }) satisfies CrearTransferenciaDto;

describe('TransferenciasService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let servicio: TransferenciasService;

  beforeEach(() => {
    prisma = crearPrisma();
    servicio = new TransferenciasService(prisma as unknown as PrismaService);
  });

  it('E11-H4 · transferencia: resta en el origen con condición atómica y suma en el destino', async () => {
    await servicio.registrar(dtoBase(), 'uuid-bodeguero');

    expect(prisma.tx.existencia.updateMany).toHaveBeenCalledWith({
      where: { formatoId: 11, ubicacionId: 1, cantidad: { gte: 5 } },
      data: { cantidad: { decrement: 5 } },
    });
    expect(prisma.tx.$executeRaw).toHaveBeenCalledOnce();
  });

  it('E11-H4 · transferencia: deja un movimiento con ambas ubicaciones y devuelve el stock de cada una', async () => {
    const transferencia = await servicio.registrar(
      { ...dtoBase(), observacion: 'Reposición' },
      'uuid-bodeguero',
    );

    expect(prisma.tx.movimientoInventario.create).toHaveBeenCalledWith({
      data: {
        formatoId: 11,
        ubicacionOrigenId: 1,
        ubicacionDestinoId: 2,
        usuarioId: 7,
        tipo: 'transferencia',
        cantidad: 5,
        observacion: 'Reposición',
      },
      select: { id: true, fechaHora: true },
    });
    expect(transferencia).toEqual({
      movimientoId: 900,
      formatoId: 11,
      origen: { id: 1, codigo: 'GONDOLA-1', bodega: 'Tienda', stock: 5 },
      destino: { id: 2, codigo: 'GONDOLA-2', bodega: 'Tienda', stock: 15 },
      cantidad: 5,
      observacion: 'Reposición',
      fechaHora: FECHA,
    });
  });

  it('E11-H4 · transferencia: toca las existencias en orden de ubicación, para que dos transferencias cruzadas no se bloqueen', async () => {
    await servicio.registrar(dtoBase(), 'uuid');
    expect(prisma.orden).toEqual(['descontar', 'sumar']);

    prisma.orden.length = 0;
    await servicio.registrar(
      { ...dtoBase(), ubicacionOrigenId: 2, ubicacionDestinoId: 1 },
      'uuid',
    );
    expect(prisma.orden).toEqual(['sumar', 'descontar']);
  });

  it('E11-H4 · transferencia sin stock: la rechaza sin crear el movimiento', async () => {
    prisma.tx.existencia.updateMany.mockResolvedValue({ count: 0 });
    prisma.tx.existencia.findUnique.mockResolvedValue({ cantidad: 3 });

    await expect(servicio.registrar(dtoBase(), 'uuid')).rejects.toThrow(
      new BadRequestException(
        'No hay stock suficiente en esa ubicación: hay 3 y la transferencia es de 5.',
      ),
    );
    expect(prisma.tx.movimientoInventario.create).not.toHaveBeenCalled();
  });

  it('E11-H4 · transferencia: rechaza que el origen y el destino sean la misma ubicación', async () => {
    await expect(
      servicio.registrar({ ...dtoBase(), ubicacionDestinoId: 1 }, 'uuid'),
    ).rejects.toThrow(
      'La ubicación de destino debe ser distinta de la de origen.',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('E11-H4 · transferencia: el destino debe estar activo; el origen puede estar desactivado', async () => {
    prisma.tx.ubicacion.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(ubicacion(where.id, where.id !== 2)),
    );
    await expect(servicio.registrar(dtoBase(), 'uuid')).rejects.toThrow(
      'La ubicación o su bodega está desactivada: elige otra ubicación.',
    );
    expect(prisma.tx.existencia.updateMany).not.toHaveBeenCalled();

    prisma.tx.ubicacion.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(ubicacion(where.id, where.id !== 1)),
    );
    await expect(servicio.registrar(dtoBase(), 'uuid')).resolves.toBeDefined();
  });

  it('E11-H4 · transferencia: si el destino superaría el máximo del stock, la rechaza', async () => {
    prisma.tx.$executeRaw.mockResolvedValue(0);

    await expect(servicio.registrar(dtoBase(), 'uuid')).rejects.toThrow(
      'El stock de ese formato en la ubicación de destino superaría el máximo permitido.',
    );
    expect(prisma.tx.movimientoInventario.create).not.toHaveBeenCalled();
  });

  it('rechaza una cuenta que ya no existe (401)', async () => {
    prisma.tx.usuario.findUnique.mockResolvedValue(null);

    await expect(servicio.registrar(dtoBase(), 'uuid')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
