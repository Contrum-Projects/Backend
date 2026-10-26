import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CrearEntradaDto } from './dto/crear-entrada.dto.js';
import {
  EntradasService,
  normalizarNumeroDocumento,
} from './entradas.service.js';

const crearPrisma = () => {
  const tx = {
    usuario: { findUnique: vi.fn().mockResolvedValue({ id: 7 }) },
    proveedor: {
      findUnique: vi.fn().mockResolvedValue({
        id: 3,
        rut: '76086428-5',
        razonSocial: 'Distribuidora Capilar SpA',
        activo: true,
      }),
    },
    ubicacion: {
      findUnique: vi.fn().mockResolvedValue({
        id: 1,
        codigo: 'RECEPCION',
        activa: true,
        bodega: { nombre: 'Tienda', activa: true },
      }),
    },
    formatoProducto: {
      findMany: vi.fn().mockResolvedValue([{ id: 11 }, { id: 12 }]),
    },
    entradaInventario: { create: vi.fn().mockResolvedValue({ id: 50 }) },
    movimientoInventario: {
      createManyAndReturn: vi.fn().mockResolvedValue([
        { id: 900, formatoId: 11 },
        { id: 901, formatoId: 12 },
      ]),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  return {
    tx,
    $transaction: vi.fn((fn: (cliente: typeof tx) => unknown) => fn(tx)),
  };
};

const dtoBase = () =>
  ({
    proveedorId: 3,
    fechaRecepcion: '2026-10-24',
    tipoDocumento: 'factura',
    numeroDocumento: 'F-12345',
    ubicacionId: 1,
    detalles: [
      { formatoId: 12, cantidad: 6, costoUnitarioNeto: 0 },
      { formatoId: 11, cantidad: 24, costoUnitarioNeto: 3500 },
    ],
  }) satisfies CrearEntradaDto;

/** Valores interpolados en `$executeRaw` (el primer argumento son los trozos del SQL). */
const valoresSql = (llamada: unknown[]) => llamada.slice(1);

describe('EntradasService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let servicio: EntradasService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 25 oct 2026, 12:00 en Chile
    vi.setSystemTime(new Date('2026-10-25T15:00:00Z'));
    prisma = crearPrisma();
    servicio = new EntradasService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('E11-H2 · entrada registrada: guarda la entrada con su documento y el detalle de cada formato', async () => {
    await servicio.registrar(
      { ...dtoBase(), observacion: 'Caja abierta' },
      'uuid-bodeguero',
    );

    expect(prisma.tx.entradaInventario.create).toHaveBeenCalledWith({
      data: {
        proveedorId: 3,
        usuarioId: 7,
        fechaRecepcion: new Date('2026-10-24T00:00:00Z'),
        tipoDocumentoProveedor: 'factura',
        numeroDocumentoProveedor: 'F-12345',
        observacion: 'Caja abierta',
        detalles: {
          create: [
            { formatoId: 12, cantidadRecibida: 6, costoUnitarioNeto: 0 },
            { formatoId: 11, cantidadRecibida: 24, costoUnitarioNeto: 3500 },
          ],
        },
      },
      select: { id: true },
    });
  });

  it('E11-H2 · entrada registrada: suma lo recibido al stock de la ubicación, formato por formato en orden', async () => {
    await servicio.registrar(dtoBase(), 'uuid-bodeguero');

    const llamadas = prisma.tx.$executeRaw.mock.calls;
    expect(llamadas).toHaveLength(2);
    expect(valoresSql(llamadas[0])).toEqual([11, 1, 24, 2_147_483_647]);
    expect(valoresSql(llamadas[1])).toEqual([12, 1, 6, 2_147_483_647]);
    expect((llamadas[0][0] as string[]).join('?')).toContain(
      'ON CONFLICT (id_formato, id_ubicacion) DO UPDATE',
    );
  });

  it('E11-H2 · entrada registrada: deja un movimiento de entrada por formato ligado a la entrada', async () => {
    const entrada = await servicio.registrar(dtoBase(), 'uuid-bodeguero');

    expect(
      prisma.tx.movimientoInventario.createManyAndReturn,
    ).toHaveBeenCalledWith({
      data: [11, 12].map((formatoId) => ({
        formatoId,
        entradaId: 50,
        ubicacionDestinoId: 1,
        usuarioId: 7,
        tipo: 'entrada',
        cantidad: formatoId === 11 ? 24 : 6,
      })),
      select: { id: true, formatoId: true },
    });
    expect(entrada).toEqual({
      id: 50,
      proveedor: {
        id: 3,
        rut: '76086428-5',
        razonSocial: 'Distribuidora Capilar SpA',
      },
      fechaRecepcion: '2026-10-24',
      tipoDocumento: 'factura',
      numeroDocumento: 'F-12345',
      observacion: null,
      ubicacion: { id: 1, codigo: 'RECEPCION', bodega: 'Tienda' },
      detalles: [
        {
          formatoId: 11,
          cantidad: 24,
          costoUnitarioNeto: 3500,
          movimientoId: 900,
        },
        { formatoId: 12, cantidad: 6, costoUnitarioNeto: 0, movimientoId: 901 },
      ],
    });
  });

  it('E11-H2 · datos faltantes: un proveedor que no existe no registra la entrada', async () => {
    prisma.tx.proveedor.findUnique.mockResolvedValue(null);

    await expect(
      servicio.registrar(dtoBase(), 'uuid-bodeguero'),
    ).rejects.toThrow(new BadRequestException('El proveedor no existe.'));
    expect(prisma.tx.entradaInventario.create).not.toHaveBeenCalled();
    expect(prisma.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('rechaza la entrada de un proveedor desactivado', async () => {
    prisma.tx.proveedor.findUnique.mockResolvedValue({
      id: 3,
      rut: '76086428-5',
      razonSocial: 'X',
      activo: false,
    });

    await expect(
      servicio.registrar(dtoBase(), 'uuid-bodeguero'),
    ).rejects.toThrow(
      new BadRequestException(
        'El proveedor está desactivado: no se le pueden registrar entradas.',
      ),
    );
    expect(prisma.tx.entradaInventario.create).not.toHaveBeenCalled();
  });

  it('rechaza una ubicación que no existe, desactivada o de una bodega desactivada', async () => {
    prisma.tx.ubicacion.findUnique.mockResolvedValueOnce(null);
    await expect(
      servicio.registrar(dtoBase(), 'uuid-bodeguero'),
    ).rejects.toThrow(new BadRequestException('La ubicación no existe.'));

    for (const [activa, bodegaActiva] of [
      [false, true],
      [true, false],
    ]) {
      prisma.tx.ubicacion.findUnique.mockResolvedValueOnce({
        id: 1,
        codigo: 'A-1',
        activa,
        bodega: { nombre: 'Tienda', activa: bodegaActiva },
      });
      await expect(
        servicio.registrar(dtoBase(), 'uuid-bodeguero'),
      ).rejects.toThrow(
        'La ubicación o su bodega está desactivada: elige otra ubicación.',
      );
    }
    expect(prisma.tx.entradaInventario.create).not.toHaveBeenCalled();
  });

  it('rechaza formatos que no existen e indica cuáles', async () => {
    prisma.tx.formatoProducto.findMany.mockResolvedValue([{ id: 11 }]);

    await expect(
      servicio.registrar(dtoBase(), 'uuid-bodeguero'),
    ).rejects.toThrow(new BadRequestException('El formato 12 no existe.'));

    prisma.tx.formatoProducto.findMany.mockResolvedValue([]);
    await expect(
      servicio.registrar(dtoBase(), 'uuid-bodeguero'),
    ).rejects.toThrow('Los formatos 11, 12 no existen.');
    expect(prisma.tx.entradaInventario.create).not.toHaveBeenCalled();
  });

  it('rechaza una fecha de recepción posterior a hoy en Chile, sin abrir la transacción', async () => {
    // A las 23:30 del 25 en Chile ya es 26 en UTC: el 25 sigue siendo hoy
    vi.setSystemTime(new Date('2026-10-26T02:30:00Z'));
    await servicio.registrar(
      { ...dtoBase(), fechaRecepcion: '2026-10-25' },
      'uuid-bodeguero',
    );

    prisma.$transaction.mockClear();
    await expect(
      servicio.registrar(
        { ...dtoBase(), fechaRecepcion: '2026-10-26' },
        'uuid-bodeguero',
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'La fecha de recepción no puede ser posterior a hoy.',
      ),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('guarda el número de documento sin espacios y en mayúsculas', async () => {
    const entrada = await servicio.registrar(
      { ...dtoBase(), numeroDocumento: 'f-123 45' },
      'uuid-bodeguero',
    );

    expect(prisma.tx.entradaInventario.create.mock.calls[0][0]).toMatchObject({
      data: { numeroDocumentoProveedor: 'F-12345' },
    });
    expect(entrada.numeroDocumento).toBe('F-12345');
    expect(normalizarNumeroDocumento(' gd	77 ')).toBe('GD77');
  });

  it('una suma que pasaría el máximo del stock responde 400 y no deja movimientos', async () => {
    prisma.tx.$executeRaw.mockResolvedValueOnce(0);

    await expect(
      servicio.registrar(dtoBase(), 'uuid-bodeguero'),
    ).rejects.toThrow(
      new BadRequestException(
        'El stock del formato 11 en esa ubicación superaría el máximo permitido.',
      ),
    );
    expect(
      prisma.tx.movimientoInventario.createManyAndReturn,
    ).not.toHaveBeenCalled();
  });

  it('el mismo documento del proveedor ya registrado responde 409', async () => {
    prisma.tx.entradaInventario.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'prueba',
      }),
    );

    await expect(
      servicio.registrar(dtoBase(), 'uuid-bodeguero'),
    ).rejects.toThrow(
      new ConflictException(
        'Ya hay una entrada registrada con ese documento del proveedor.',
      ),
    );
    expect(prisma.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('un error de la base que no es de unicidad no se disfraza de documento repetido', async () => {
    prisma.tx.entradaInventario.create.mockRejectedValue(
      new Error('conexión perdida'),
    );

    await expect(
      servicio.registrar(dtoBase(), 'uuid-bodeguero'),
    ).rejects.toThrow('conexión perdida');
  });
});
