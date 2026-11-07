import type { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ListadoProductosService } from './listado-productos.service.js';

const producto = (extra: object = {}) => ({
  id: 7,
  nombre: 'Shampoo',
  canalVenta: 'general',
  activo: true,
  marca: null,
  categoria: { id: 3, nombre: 'Cuidado' },
  ...extra,
});

const formato = (extra: object = {}) => ({
  id: 21,
  productoId: 7,
  esPredeterminado: true,
  articulo: {
    activo: true,
    precioMinoristaNeto: new Prisma.Decimal(8403),
    precioMayoristaNeto: new Prisma.Decimal(6000),
    imagenes: [{ ubicacionArchivo: 'productos/21/a.jpg' }],
  },
  ...extra,
});

const crear = (filas: object[], formatos: object[], bajos: number[] = []) => {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue(bajos.map((id) => ({ id }))),
    producto: {
      findMany: vi.fn().mockResolvedValue(filas),
      count: vi.fn().mockResolvedValue(filas.length),
    },
    formatoProducto: { findMany: vi.fn().mockResolvedValue(formatos) },
    existencia: {
      groupBy: vi
        .fn()
        .mockResolvedValue([{ formatoId: 21, _sum: { cantidad: 4 } }]),
    },
    $transaction: vi.fn((consultas: Promise<unknown>[]) =>
      Promise.all(consultas),
    ),
  };
  const variables: Partial<Record<keyof Entorno, unknown>> = {
    IVA_PORCENTAJE: 19,
    R2_URL_PUBLICA: 'https://imagenes.cabelloperfecto.cl',
  };
  const servicio = new ListadoProductosService(
    prisma as unknown as PrismaService,
    {
      get: vi.fn((nombre: keyof Entorno) => variables[nombre]),
    } as unknown as ConfigService<Entorno, true>,
  );
  return { prisma, servicio };
};

describe('ListadoProductosService', () => {
  it('E3-H1 · cada fila: foto del predeterminado, formatos activos, precio desde con IVA, stock y stock bajo', async () => {
    const { servicio } = crear(
      [producto(), producto({ id: 8, canalVenta: 'profesional' })],
      [
        formato(),
        formato({
          id: 22,
          esPredeterminado: false,
          articulo: {
            activo: false,
            precioMinoristaNeto: new Prisma.Decimal(1),
            precioMayoristaNeto: null,
            imagenes: [],
          },
        }),
        formato({ id: 23, productoId: 8, esPredeterminado: false }),
      ],
      [7],
    );

    const { items } = await servicio.listar({});

    expect(items[0]).toMatchObject({
      id: 7,
      imagen: 'https://imagenes.cabelloperfecto.cl/productos/21/a.jpg',
      // El desactivado no cuenta ni da precio
      formatos: 1,
      precioDesde: 10000,
      stockTotal: 4,
      stockBajo: true,
    });
    // Exclusivo: con su mayorista; sin predeterminado, sin foto
    expect(items[1]).toMatchObject({
      id: 8,
      imagen: null,
      precioDesde: 7140,
      stockTotal: 0,
      stockBajo: false,
    });
  });

  it('E3-H1 · los chips: solo inactivos, canal y stock bajo, y los conteos con la búsqueda', async () => {
    const { prisma, servicio } = crear([], [], [7, 9]);

    const listado = await servicio.listar({
      buscar: 'sha',
      soloInactivos: true,
      canalVenta: 'profesional',
      stockBajo: true,
    });

    const { where } = prisma.producto.findMany.mock.calls[0][0] as {
      where: { AND: object[] };
    };
    expect(where.AND).toEqual([
      expect.objectContaining({ OR: expect.any(Array) as unknown }),
      { activo: false },
      { canalVenta: 'profesional' },
      { id: { in: [7, 9] } },
    ]);
    expect(prisma.producto.count).toHaveBeenCalledTimes(5);
    expect(listado.conteos).toEqual({
      todos: 0,
      exclusivos: 0,
      stockBajo: 0,
      inactivos: 0,
    });
    // Sin filas no busca sus formatos
    expect(prisma.formatoProducto.findMany).not.toHaveBeenCalled();
  });
});
