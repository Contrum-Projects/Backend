import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { TrabajoStockBajo } from '../../colas/colas.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AjustesService } from './ajustes.service.js';
import type { CrearAjusteDto } from './dto/crear-ajuste.dto.js';
import type { StockBajoService } from './stock-bajo.service.js';

const FECHA = new Date('2026-10-25T15:00:00Z');

const crearPrisma = () => {
  const tx = {
    usuario: { findUnique: vi.fn().mockResolvedValue({ id: 7 }) },
    formatoProducto: { findUnique: vi.fn().mockResolvedValue({ id: 11 }) },
    ubicacion: {
      findUnique: vi.fn().mockResolvedValue({
        id: 1,
        codigo: 'GONDOLA-1',
        activa: true,
        bodega: { nombre: 'Tienda', activa: true },
      }),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
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

const dtoBase = (cantidad: number) =>
  ({
    formatoId: 11,
    ubicacionId: 1,
    cantidad,
    observacion: 'Conteo físico',
  }) satisfies CrearAjusteDto;

const crearStockBajo = () => ({
  stockAntes: vi.fn().mockResolvedValue(10),
  avisarSiCruza: vi.fn().mockResolvedValue([]),
  encolar: vi.fn().mockResolvedValue(undefined),
});

describe('AjustesService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let stockBajo: ReturnType<typeof crearStockBajo>;
  let servicio: AjustesService;

  beforeEach(() => {
    prisma = crearPrisma();
    stockBajo = crearStockBajo();
    servicio = new AjustesService(
      prisma as unknown as PrismaService,
      stockBajo as unknown as StockBajoService,
    );
  });

  it('E11-H6 · stock bajo el mínimo: un ajuste negativo revisa el mínimo y encola los avisos', async () => {
    const aviso = { notificacionId: 70 } as TrabajoStockBajo;
    stockBajo.avisarSiCruza.mockResolvedValue([aviso]);

    await servicio.registrar(dtoBase(-2), 'uuid-bodeguero');

    expect(stockBajo.stockAntes).toHaveBeenCalledWith(prisma.tx, 11);
    expect(stockBajo.avisarSiCruza).toHaveBeenCalledWith(prisma.tx, 11, 10);
    expect(stockBajo.encolar).toHaveBeenCalledWith([aviso]);
  });

  it('E11-H6 · stock sobre el mínimo: un ajuste positivo no puede bajar el stock y no revisa el mínimo', async () => {
    await servicio.registrar(dtoBase(3), 'uuid-bodeguero');

    expect(stockBajo.stockAntes).not.toHaveBeenCalled();
    expect(stockBajo.avisarSiCruza).not.toHaveBeenCalled();
    expect(stockBajo.encolar).toHaveBeenCalledWith([]);
  });

  it('E11-H4 · ajuste positivo: suma el stock y deja un movimiento ajuste_positivo con la ubicación de destino', async () => {
    const ajuste = await servicio.registrar(dtoBase(3), 'uuid-bodeguero');

    expect(prisma.tx.$executeRaw).toHaveBeenCalledOnce();
    expect(prisma.tx.existencia.updateMany).not.toHaveBeenCalled();
    expect(prisma.tx.movimientoInventario.create).toHaveBeenCalledWith({
      data: {
        formatoId: 11,
        ubicacionDestinoId: 1,
        usuarioId: 7,
        tipo: 'ajuste_positivo',
        cantidad: 3,
        observacion: 'Conteo físico',
      },
      select: { id: true, fechaHora: true },
    });
    expect(ajuste).toEqual({
      movimientoId: 900,
      tipo: 'ajuste_positivo',
      formatoId: 11,
      ubicacion: { id: 1, codigo: 'GONDOLA-1', bodega: 'Tienda' },
      cantidad: 3,
      stockResultante: 8,
      observacion: 'Conteo físico',
      fechaHora: FECHA,
    });
  });

  it('E11-H4 · ajuste negativo: descuenta con condición atómica y deja un movimiento ajuste_negativo con la cantidad sin signo', async () => {
    const ajuste = await servicio.registrar(dtoBase(-2), 'uuid-bodeguero');

    expect(prisma.tx.existencia.updateMany).toHaveBeenCalledWith({
      where: { formatoId: 11, ubicacionId: 1, cantidad: { gte: 2 } },
      data: { cantidad: { decrement: 2 } },
    });
    expect(prisma.tx.movimientoInventario.create).toHaveBeenCalledWith({
      data: {
        formatoId: 11,
        ubicacionOrigenId: 1,
        usuarioId: 7,
        tipo: 'ajuste_negativo',
        cantidad: 2,
        observacion: 'Conteo físico',
      },
      select: { id: true, fechaHora: true },
    });
    expect(ajuste).toMatchObject({
      tipo: 'ajuste_negativo',
      cantidad: -2,
      stockResultante: 8,
    });
  });

  it('E11-H4 · ajuste negativo mayor que el stock: lo rechaza sin crear el movimiento', async () => {
    prisma.tx.existencia.updateMany.mockResolvedValue({ count: 0 });
    prisma.tx.existencia.findUnique.mockResolvedValue({ cantidad: 1 });

    await expect(servicio.registrar(dtoBase(-2), 'uuid')).rejects.toThrow(
      new BadRequestException(
        'No hay stock suficiente en esa ubicación: hay 1 y el ajuste es de 2.',
      ),
    );
    expect(prisma.tx.movimientoInventario.create).not.toHaveBeenCalled();
  });

  it('E11-H4 · ajuste positivo que pasaría el máximo del stock: lo rechaza sin crear el movimiento', async () => {
    prisma.tx.$executeRaw.mockResolvedValue(0);

    await expect(servicio.registrar(dtoBase(5), 'uuid')).rejects.toThrow(
      'El stock de ese formato en esa ubicación superaría el máximo permitido.',
    );
    expect(prisma.tx.movimientoInventario.create).not.toHaveBeenCalled();
  });

  it('E11-H4 · ajuste de stock: rechaza un formato o una ubicación que no existen sin tocar el stock', async () => {
    prisma.tx.formatoProducto.findUnique.mockResolvedValueOnce(null);
    await expect(servicio.registrar(dtoBase(1), 'uuid')).rejects.toThrow(
      'El formato no existe.',
    );

    prisma.tx.ubicacion.findUnique.mockResolvedValueOnce(null);
    await expect(servicio.registrar(dtoBase(1), 'uuid')).rejects.toThrow(
      'La ubicación no existe.',
    );
    expect(prisma.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('E11-H4 · ajuste de stock: se admite en una ubicación desactivada', async () => {
    prisma.tx.ubicacion.findUnique.mockResolvedValue({
      id: 1,
      codigo: 'GONDOLA-1',
      activa: false,
      bodega: { nombre: 'Tienda', activa: false },
    });

    await expect(
      servicio.registrar(dtoBase(-1), 'uuid'),
    ).resolves.toMatchObject({ tipo: 'ajuste_negativo' });
  });

  it('rechaza una cuenta que ya no existe (401)', async () => {
    prisma.tx.usuario.findUnique.mockResolvedValue(null);

    await expect(servicio.registrar(dtoBase(1), 'uuid')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
