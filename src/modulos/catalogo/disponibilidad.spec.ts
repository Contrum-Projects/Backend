import type { Prisma } from '../../generated/prisma/client.js';
import {
  disponibilidad,
  EXISTENCIA_VENDIBLE,
  stockVendible,
  unidadesDePack,
} from './disponibilidad.js';

const crearPrisma = (filas: { formatoId: number; cantidad: number | null }[]) =>
  ({
    existencia: {
      groupBy: vi.fn().mockResolvedValue(
        filas.map(({ formatoId, cantidad }) => ({
          formatoId,
          _sum: { cantidad },
        })),
      ),
    },
  }) as unknown as Pick<Prisma.TransactionClient, 'existencia'> & {
    existencia: { groupBy: ReturnType<typeof vi.fn> };
  };

describe('disponibilidad', () => {
  it('E2-H3 · formato con stock: con al menos una unidad vendible es disponible', () => {
    expect(disponibilidad(1)).toBe('disponible');
    expect(disponibilidad(40)).toBe('disponible');
  });

  it('E2-H3 · formato sin stock: sin unidades vendibles es agotado', () => {
    expect(disponibilidad(0)).toBe('agotado');
  });

  it('E2-H3 · formato sin stock: solo cuenta el stock de ubicaciones y bodegas activas que abastecen la venta online', async () => {
    const prisma = crearPrisma([{ formatoId: 10, cantidad: 3 }]);

    const stock = await stockVendible(prisma, [10, 11]);

    expect(prisma.existencia.groupBy).toHaveBeenCalledWith({
      by: ['formatoId'],
      where: { formatoId: { in: [10, 11] }, ...EXISTENCIA_VENDIBLE },
      _sum: { cantidad: true },
    });
    expect(EXISTENCIA_VENDIBLE).toEqual({
      ubicacion: {
        activa: true,
        bodega: { activa: true, abasteceVentaOnline: true },
      },
    });
    expect(stock.get(10)).toBe(3);
    // Sin existencias vendibles no aparece: vale 0
    expect(unidadesDePack([{ formatoId: 11, cantidad: 1 }], stock)).toBe(0);
  });

  it('sin formatos no consulta la base', async () => {
    const prisma = crearPrisma([]);

    expect((await stockVendible(prisma, [])).size).toBe(0);
    expect(prisma.existencia.groupBy).not.toHaveBeenCalled();
  });

  it('E2-H3 · disponibilidad de un pack: manda el componente más escaso', () => {
    const stock = new Map([
      [10, 50],
      [11, 2],
    ]);

    expect(
      unidadesDePack(
        [
          { formatoId: 10, cantidad: 1 },
          { formatoId: 11, cantidad: 1 },
        ],
        stock,
      ),
    ).toBe(2);
  });

  it('E2-H3 · disponibilidad de un pack: un componente que lleva 2 unidades con 1 en stock lo deja agotado', () => {
    const stock = new Map([
      [10, 50],
      [11, 1],
    ]);
    const unidades = unidadesDePack(
      [
        { formatoId: 10, cantidad: 1 },
        { formatoId: 11, cantidad: 2 },
      ],
      stock,
    );

    expect(unidades).toBe(0);
    expect(disponibilidad(unidades)).toBe('agotado');
  });

  it('un pack sin componentes no se puede armar', () => {
    expect(unidadesDePack([], new Map())).toBe(0);
  });
});
