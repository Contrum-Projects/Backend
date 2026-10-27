import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { StockService } from './stock.service.js';

const existencia = (
  id: number,
  codigo: string,
  cantidad: number,
  { activa = true, bodegaActiva = true, bodega = 'Tienda' } = {},
) => ({
  cantidad,
  ubicacion: {
    id,
    codigo,
    activa,
    bodega: { nombre: bodega, activa: bodegaActiva },
  },
});

const formatoBase = () => ({
  id: 11,
  nombreFormato: '300 ml',
  articulo: { sku: 'SH-300', activo: true },
  producto: { nombre: 'Shampoo Reparador' },
  existencias: [
    existencia(1, 'GONDOLA-1', 4),
    existencia(3, 'A-01', 6, { bodega: 'Bodega central' }),
  ],
  detallesEntrada: [
    {
      costoUnitarioNeto: new Prisma.Decimal('2490.50'),
      entrada: {
        fechaRecepcion: new Date('2026-10-20T00:00:00Z'),
        proveedor: {
          id: 5,
          rut: '76086430-7',
          razonSocial: 'Distribuidora Sur',
        },
      },
    },
  ],
});

const crearPrisma = () => ({
  formatoProducto: { findUnique: vi.fn().mockResolvedValue(formatoBase()) },
});

describe('StockService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let servicio: StockService;

  beforeEach(() => {
    prisma = crearPrisma();
    servicio = new StockService(prisma as unknown as PrismaService);
  });

  const consulta = () =>
    prisma.formatoProducto.findUnique.mock.calls[0][0] as {
      where: { id: number };
      select: {
        existencias: { where: unknown; orderBy: unknown };
        detallesEntrada: { orderBy: unknown; take: number };
      };
    };

  it('E11-H5 · stock por ubicación: devuelve la cantidad en cada ubicación y el total', async () => {
    const stock = await servicio.consultar(11);

    expect(consulta().where).toEqual({ id: 11 });
    expect(stock.formato).toEqual({
      id: 11,
      nombreFormato: '300 ml',
      sku: 'SH-300',
      producto: 'Shampoo Reparador',
      activo: true,
    });
    expect(stock.ubicaciones).toEqual([
      {
        id: 1,
        codigo: 'GONDOLA-1',
        bodega: 'Tienda',
        activa: true,
        cantidad: 4,
      },
      {
        id: 3,
        codigo: 'A-01',
        bodega: 'Bodega central',
        activa: true,
        cantidad: 6,
      },
    ]);
    expect(stock.total).toBe(10);
  });

  it('E11-H5 · stock por ubicación: omite las ubicaciones sin unidades y las ordena por bodega y código', async () => {
    await servicio.consultar(11);

    expect(consulta().select.existencias.where).toEqual({
      cantidad: { gt: 0 },
    });
    expect(consulta().select.existencias.orderBy).toEqual([
      { ubicacion: { bodega: { nombre: 'asc' } } },
      { ubicacion: { codigo: 'asc' } },
      { ubicacionId: 'asc' },
    ]);
  });

  it('E11-H5 · stock por ubicación: incluye el stock de ubicaciones o bodegas desactivadas, marcadas como inactivas', async () => {
    prisma.formatoProducto.findUnique.mockResolvedValue({
      ...formatoBase(),
      existencias: [
        existencia(1, 'GONDOLA-1', 2, { activa: false }),
        existencia(2, 'A-01', 3, { bodegaActiva: false }),
      ],
    });

    const stock = await servicio.consultar(11);

    expect(stock.ubicaciones.map((u) => u.activa)).toEqual([false, false]);
    expect(stock.total).toBe(5);
  });

  it('E11-H5 · último proveedor y costo: devuelve el proveedor y el costo unitario de la entrada más reciente', async () => {
    const stock = await servicio.consultar(11);

    expect(stock.ultimaEntrada).toEqual({
      fechaRecepcion: '2026-10-20',
      proveedor: { id: 5, rut: '76086430-7', razonSocial: 'Distribuidora Sur' },
      costoUnitarioNeto: 2490.5,
    });
  });

  it('E11-H5 · último proveedor y costo: la más reciente es la de fecha de recepción mayor y, si empatan, la registrada después', async () => {
    await servicio.consultar(11);

    expect(consulta().select.detallesEntrada.orderBy).toEqual([
      { entrada: { fechaRecepcion: 'desc' } },
      { entrada: { id: 'desc' } },
    ]);
    expect(consulta().select.detallesEntrada.take).toBe(1);
  });

  it('E11-H5 · formato sin entradas: devuelve stock cero y ningún proveedor ni costo', async () => {
    prisma.formatoProducto.findUnique.mockResolvedValue({
      ...formatoBase(),
      existencias: [],
      detallesEntrada: [],
    });

    const stock = await servicio.consultar(11);

    expect(stock.ubicaciones).toEqual([]);
    expect(stock.total).toBe(0);
    expect(stock.ultimaEntrada).toBeNull();
  });

  it('un formato desactivado también se consulta', async () => {
    prisma.formatoProducto.findUnique.mockResolvedValue({
      ...formatoBase(),
      articulo: { sku: 'SH-300', activo: false },
    });

    const stock = await servicio.consultar(11);

    expect(stock.formato.activo).toBe(false);
    expect(stock.total).toBe(10);
  });

  it('un formato que no existe responde 404', async () => {
    prisma.formatoProducto.findUnique.mockResolvedValue(null);

    await expect(servicio.consultar(99)).rejects.toThrow(
      new NotFoundException('El formato no existe.'),
    );
  });
});
