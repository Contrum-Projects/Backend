import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CrearSalidaDto } from './dto/crear-salida.dto.js';
import { SalidasService } from './salidas.service.js';

const FECHA = new Date('2026-10-25T15:00:00Z');

const crearPrisma = () => {
  const tx = {
    usuario: { findUnique: vi.fn().mockResolvedValue({ id: 7 }) },
    formatoProducto: { findUnique: vi.fn().mockResolvedValue({ id: 11 }) },
    ubicacion: {
      findUnique: vi.fn().mockResolvedValue({
        id: 1,
        codigo: 'GONDOLA-1',
        bodega: { nombre: 'Tienda' },
      }),
    },
    existencia: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({ cantidad: 8 }),
    },
    movimientoInventario: {
      create: vi.fn().mockResolvedValue({ id: 900, fechaHora: FECHA }),
    },
  };
  return {
    tx,
    $transaction: vi.fn((fn: (cliente: typeof tx) => unknown) => fn(tx)),
  };
};

const dtoBase = () =>
  ({
    formatoId: 11,
    ubicacionId: 1,
    tipo: 'merma_dano',
    cantidad: 2,
  }) satisfies CrearSalidaDto;

describe('SalidasService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let servicio: SalidasService;

  beforeEach(() => {
    prisma = crearPrisma();
    servicio = new SalidasService(prisma as unknown as PrismaService);
  });

  it('E11-H3 · salida registrada: descuenta el stock con una condición atómica sobre la cantidad', async () => {
    await servicio.registrar(dtoBase(), 'uuid-bodeguero');

    expect(prisma.tx.existencia.updateMany).toHaveBeenCalledWith({
      where: { formatoId: 11, ubicacionId: 1, cantidad: { gte: 2 } },
      data: { cantidad: { decrement: 2 } },
    });
  });

  it('E11-H3 · salida registrada: deja un movimiento con el tipo de salida, la ubicación de origen y quién la registró', async () => {
    const salida = await servicio.registrar(
      { ...dtoBase(), tipo: 'consumo_peluqueria', observacion: 'Lavado' },
      'uuid-bodeguero',
    );

    expect(prisma.tx.movimientoInventario.create).toHaveBeenCalledWith({
      data: {
        formatoId: 11,
        ubicacionOrigenId: 1,
        usuarioId: 7,
        tipo: 'consumo_peluqueria',
        cantidad: 2,
        observacion: 'Lavado',
      },
      select: { id: true, fechaHora: true },
    });
    expect(salida).toEqual({
      movimientoId: 900,
      tipo: 'consumo_peluqueria',
      formatoId: 11,
      ubicacion: { id: 1, codigo: 'GONDOLA-1', bodega: 'Tienda' },
      cantidad: 2,
      stockRestante: 8,
      observacion: 'Lavado',
      fechaHora: FECHA,
    });
  });

  it('E11-H3 · cantidad mayor al stock: rechaza la salida sin crear el movimiento', async () => {
    prisma.tx.existencia.updateMany.mockResolvedValue({ count: 0 });
    prisma.tx.existencia.findUnique.mockResolvedValue({ cantidad: 1 });

    await expect(servicio.registrar(dtoBase(), 'uuid')).rejects.toThrow(
      new BadRequestException(
        'No hay stock suficiente en esa ubicación: hay 1 y la salida es de 2.',
      ),
    );
    expect(prisma.tx.movimientoInventario.create).not.toHaveBeenCalled();
  });

  it('E11-H3 · cantidad mayor al stock: sin existencia del formato en la ubicación, informa 0', async () => {
    prisma.tx.existencia.updateMany.mockResolvedValue({ count: 0 });
    prisma.tx.existencia.findUnique.mockResolvedValue(null);

    await expect(servicio.registrar(dtoBase(), 'uuid')).rejects.toThrow(
      'No hay stock suficiente en esa ubicación: hay 0 y la salida es de 2.',
    );
    expect(prisma.tx.movimientoInventario.create).not.toHaveBeenCalled();
  });

  it('E11-H3 · salida registrada: rechaza un formato o una ubicación que no existen sin tocar el stock', async () => {
    prisma.tx.formatoProducto.findUnique.mockResolvedValueOnce(null);
    await expect(servicio.registrar(dtoBase(), 'uuid')).rejects.toThrow(
      'El formato no existe.',
    );

    prisma.tx.ubicacion.findUnique.mockResolvedValueOnce(null);
    await expect(servicio.registrar(dtoBase(), 'uuid')).rejects.toThrow(
      'La ubicación no existe.',
    );
    expect(prisma.tx.existencia.updateMany).not.toHaveBeenCalled();
  });

  it('rechaza una cuenta que ya no existe (401)', async () => {
    prisma.tx.usuario.findUnique.mockResolvedValue(null);

    await expect(servicio.registrar(dtoBase(), 'uuid')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
