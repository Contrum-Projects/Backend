import type { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ListadoStockService } from './listado-stock.service.js';

const formato = (extra: object = {}) => ({
  id: 21,
  nombreFormato: '300 ml',
  stockMinimo: 10,
  producto: { nombre: 'Shampoo reparador' },
  articulo: { sku: 'SH-REP-300', imagenes: [] },
  existencias: [
    { cantidad: 4, ubicacion: { id: 1, codigo: 'A-01' } },
    { cantidad: 3, ubicacion: { id: 2, codigo: 'B-01' } },
  ],
  detallesEntrada: [
    {
      costoUnitarioNeto: new Prisma.Decimal('3500.5'),
      entrada: { proveedor: { id: 9, razonSocial: 'Distribuidora SpA' } },
    },
  ],
  ...extra,
});

const crear = (pagina: object[], formatos: object[]) => {
  const prisma = {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ total: 3n, bajos: 1n }])
      .mockResolvedValueOnce(pagina),
    formatoProducto: { findMany: vi.fn().mockResolvedValue(formatos) },
  };
  const servicio = new ListadoStockService(
    prisma as unknown as PrismaService,
    {
      get: vi.fn().mockReturnValue('https://imagenes.cabelloperfecto.cl'),
    } as unknown as ConfigService<Entorno, true>,
  );
  return { prisma, servicio };
};

describe('ListadoStockService', () => {
  it('E11-H5 · stock: suma las unidades, arma la foto y toma el costo y proveedor de la última entrada', async () => {
    const { servicio } = crear(
      [
        { id: 21, bajo: true },
        { id: 22, bajo: false },
      ],
      [
        // Prisma no respeta el orden de la página: manda el de la consulta paginada
        formato({
          id: 22,
          stockMinimo: 0,
          existencias: [],
          detallesEntrada: [],
          articulo: {
            sku: 'AC-1L',
            imagenes: [{ ubicacionArchivo: 'articulos/22/a.webp' }],
          },
        }),
        formato(),
      ],
    );

    const listado = await servicio.listar({});

    expect(listado).toEqual({
      items: [
        {
          formatoId: 21,
          sku: 'SH-REP-300',
          producto: 'Shampoo reparador',
          nombreFormato: '300 ml',
          imagen: null,
          ubicaciones: [
            { id: 1, codigo: 'A-01' },
            { id: 2, codigo: 'B-01' },
          ],
          stock: 7,
          stockMinimo: 10,
          bajoMinimo: true,
          ultimaEntrada: {
            costoUnitarioNeto: 3500.5,
            proveedor: { id: 9, razonSocial: 'Distribuidora SpA' },
          },
        },
        expect.objectContaining({
          formatoId: 22,
          imagen: expect.stringContaining('articulos/22/a.webp') as string,
          stock: 0,
          // E11-H5 criterio 3: nunca recibido
          ultimaEntrada: null,
        }),
      ],
      total: 3,
      pagina: 1,
      limite: 20,
      totalBajoMinimo: 1,
    });
  });

  it('E11-H5 · bajo el mínimo: el total es el de los formatos bajo el mínimo', async () => {
    const { servicio } = crear([{ id: 21, bajo: true }], [formato()]);

    const listado = await servicio.listar({ bajoMinimo: true, limite: 5 });

    expect(listado).toMatchObject({ total: 1, limite: 5, totalBajoMinimo: 1 });
  });

  it('una página vacía no busca el detalle', async () => {
    const { prisma, servicio } = crear([], []);

    await expect(servicio.listar({ pagina: 9 })).resolves.toMatchObject({
      items: [],
      pagina: 9,
    });
    expect(prisma.formatoProducto.findMany).not.toHaveBeenCalled();
  });
});
