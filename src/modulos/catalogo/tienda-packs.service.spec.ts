import type { ConfigService } from '@nestjs/config';
import { hoyEnLaTienda } from '../../common/dominio/fechas.js';
import type { Entorno } from '../../config/entorno.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { TiendaPacksService } from './tienda-packs.service.js';
import { packVigente } from './vigencia-pack.js';

const fila = (extra: object = {}) => ({
  id: 30,
  nombre: 'Dúo reparador',
  descripcion: 'Shampoo y acondicionador.',
  fechaFinVigencia: new Date('2026-11-30T00:00:00Z'),
  canalVenta: 'general',
  articulo: {
    precioMinoristaNeto: new Prisma.Decimal(10_000),
    precioMayoristaNeto: new Prisma.Decimal(8_000),
    imagenes: [{ ubicacionArchivo: 'articulos/30/principal.jpg' }],
  },
  componentes: [
    {
      cantidad: 1,
      formato: {
        nombreFormato: '300 ml',
        producto: { nombre: 'Shampoo reparador' },
      },
    },
  ],
  ...extra,
});

const config = {
  get: vi.fn((clave: string) =>
    clave === 'IVA_PORCENTAJE' ? 19 : 'https://imagenes.cabelloperfecto.cl',
  ),
} as unknown as ConfigService<Entorno, true>;

const crearPrisma = () => ({
  pack: {
    findMany: vi.fn().mockResolvedValue([fila()]),
    count: vi.fn().mockResolvedValue(1),
  },
  $transaction: vi.fn((consultas: Promise<unknown>[]) =>
    Promise.all(consultas),
  ),
});

type ArgumentosConsulta = {
  where: Prisma.PackWhereInput;
  select: Prisma.PackSelect;
};

describe('TiendaPacksService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let servicio: TiendaPacksService;

  const consulta = () =>
    prisma.pack.findMany.mock.calls[0]![0] as ArgumentosConsulta;

  beforeEach(() => {
    prisma = crearPrisma();
    servicio = new TiendaPacksService(
      prisma as unknown as PrismaService,
      config,
    );
  });

  it('E3-H6 · pack fuera de vigencia: la consulta de la tienda solo trae los vigentes hoy en Chile', async () => {
    await servicio.listar({});
    await servicio.listar({}, 'profesional');

    const vigencia = packVigente(hoyEnLaTienda());
    expect(consulta().where).toMatchObject(vigencia);
    const profesional = prisma.pack.findMany.mock
      .calls[1]![0] as ArgumentosConsulta;
    expect(profesional.where.AND).toContainEqual(vigencia);
  });

  it('E3-H6 · visitante: solo packs generales con sus dos precios, imagen y componentes de productos generales', async () => {
    await servicio.listar({});

    expect(consulta().where).toMatchObject({
      canalVenta: 'general',
      articulo: {
        activo: true,
        precioMinoristaNeto: { not: null },
        precioMayoristaNeto: { not: null },
        imagenes: { some: {} },
      },
      componentes: {
        some: {},
        every: {
          formato: {
            articulo: { activo: true },
            producto: { activo: true, canalVenta: 'general' },
          },
        },
      },
    });
  });

  it('E3-H6 · el precio mayorista no se lee para quien no es profesional (RNF-04)', async () => {
    const listado = await servicio.listar({ pagina: 1, limite: 20 }, 'cliente');

    expect(consulta().select).not.toHaveProperty('canalVenta');
    expect(consulta().select.articulo).toEqual({
      select: expect.not.objectContaining({
        precioMayoristaNeto: expect.anything() as unknown,
      }) as object,
    });
    expect(listado).toEqual({
      items: [
        {
          id: 30,
          nombre: 'Dúo reparador',
          descripcion: 'Shampoo y acondicionador.',
          precio: 11_900,
          imagen:
            'https://imagenes.cabelloperfecto.cl/articulos/30/principal.jpg',
          vigenteHasta: '2026-11-30',
          componentes: [
            { producto: 'Shampoo reparador', formato: '300 ml', cantidad: 1 },
          ],
        },
      ],
      total: 1,
      pagina: 1,
      limite: 20,
    });
  });

  it('E3-H6 · profesional: ve los exclusivos con el mayorista y sin minorista', async () => {
    prisma.pack.findMany.mockResolvedValue([
      fila(),
      fila({ id: 31, canalVenta: 'profesional', fechaFinVigencia: null }),
    ]);

    const listado = await servicio.listar({}, 'profesional');

    expect(listado.items).toEqual([
      expect.objectContaining({
        id: 30,
        precio: 11_900,
        precioMayorista: 9_520,
        exclusivo: false,
      }),
      expect.objectContaining({
        id: 31,
        precio: null,
        precioMayorista: 9_520,
        exclusivo: true,
        vigenteHasta: null,
      }),
    ]);
  });
});
