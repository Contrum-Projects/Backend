import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ROLES } from '../../common/dominio/roles.js';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CacheCatalogo } from './cache-catalogo.js';
import type { CategoriasService } from './categorias.service.js';
import type { MarcasService } from './marcas.service.js';
import { TiendaService } from './tienda.service.js';

/** Categorías de prueba: Cuidado (1) > Shampoo (2) > Sin sulfato (3), y Coloración (4) es otra raíz. */
const CATEGORIAS = [
  { id: 1, padreId: null, nombre: 'Cuidado' },
  { id: 2, padreId: 1, nombre: 'Shampoo' },
  { id: 3, padreId: 2, nombre: 'Sin sulfato' },
  { id: 4, padreId: null, nombre: 'Coloración' },
];

const formato = (neto: string, extra: object = {}, imagen = 'img/a.jpg') => ({
  esPredeterminado: false,
  articulo: {
    precioMinoristaNeto: neto,
    imagenes: [{ ubicacionArchivo: imagen }],
  },
  ...extra,
});

const fila = (extra: object = {}) => ({
  id: 5,
  nombre: 'Shampoo reparador',
  marca: { id: 2, nombre: 'Kerastase' },
  categoria: { id: 3, nombre: 'Reparación' },
  formatos: [formato('10000')],
  ...extra,
});

const crearPrisma = () => ({
  producto: {
    findMany: vi.fn().mockResolvedValue([fila()]),
    count: vi.fn().mockResolvedValue(1),
  },
  categoria: { findMany: vi.fn().mockResolvedValue(CATEGORIAS) },
  marca: { findUnique: vi.fn().mockResolvedValue({ activa: true }) },
  $transaction: vi.fn((consultas: Promise<unknown>[]) =>
    Promise.all(consultas),
  ),
});

const variables: Partial<Record<keyof Entorno, unknown>> = {
  IVA_PORCENTAJE: 19,
};
const config = {
  get: vi.fn((nombre: keyof Entorno) => variables[nombre]),
} as unknown as ConfigService<Entorno, true>;

/** Filtro `where` con que se consultaron los productos. */
const whereDe = (prisma: ReturnType<typeof crearPrisma>) =>
  (prisma.producto.findMany.mock.calls[0][0] as { where: object }).where;

describe('TiendaService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let cache: { obtener: ReturnType<typeof vi.fn> };
  let categorias: { listarArbol: ReturnType<typeof vi.fn> };
  let marcas: { listar: ReturnType<typeof vi.fn> };
  let servicio: TiendaService;

  beforeEach(() => {
    prisma = crearPrisma();
    cache = {
      obtener: vi.fn((_clave: string, cargar: () => Promise<unknown>) =>
        cargar(),
      ),
    };
    categorias = { listarArbol: vi.fn().mockResolvedValue([]) };
    marcas = {
      listar: vi
        .fn()
        .mockResolvedValue([{ id: 2, nombre: 'Kerastase', activa: true }]),
    };
    servicio = new TiendaService(
      prisma as unknown as PrismaService,
      config,
      cache as unknown as CacheCatalogo,
      categorias as unknown as CategoriasService,
      marcas as unknown as MarcasService,
    );
  });

  describe('listarProductos', () => {
    it('E2-H1 · categoría con productos: busca en ella y en todas sus subcategorías', async () => {
      await servicio.listarProductos({ categoriaId: 1 });

      expect(whereDe(prisma)).toMatchObject({
        categoriaId: { in: [1, 2, 3] },
      });
    });

    it('E2-H1 · categoría con productos: devuelve imagen, nombre y precio minorista con IVA', async () => {
      const resultado = await servicio.listarProductos({ categoriaId: 3 });

      expect(resultado).toEqual({
        items: [
          {
            id: 5,
            nombre: 'Shampoo reparador',
            marca: { id: 2, nombre: 'Kerastase' },
            categoria: { id: 3, nombre: 'Reparación' },
            precio: 11900,
            imagen: 'img/a.jpg',
          },
        ],
        total: 1,
        pagina: 1,
        limite: 20,
      });
    });

    it('E3-H5 · precio guardado en neto: la tienda lo devuelve con el IVA incluido, calculado a partir del neto', async () => {
      // 8403,36 neto → se redondea a 8403 pesos, IVA 19 % = 1597, total 10000
      prisma.producto.findMany.mockResolvedValue([
        fila({ formatos: [formato('8403.36')] }),
      ]);

      const { items } = await servicio.listarProductos({});

      expect(items[0].precio).toBe(10000);
    });

    it('E3-H3 · la imagen sale con la URL pública del almacén', async () => {
      variables.R2_URL_PUBLICA = 'https://imagenes.cabelloperfecto.cl';
      try {
        const { items } = await servicio.listarProductos({ categoriaId: 3 });

        expect(items[0].imagen).toBe(
          'https://imagenes.cabelloperfecto.cl/img/a.jpg',
        );
      } finally {
        delete variables.R2_URL_PUBLICA;
      }
    });

    it('E2-H1 · solo productos activos, de venta general, con marca activa y un formato vendible', async () => {
      await servicio.listarProductos({ categoriaId: 3 });

      expect(whereDe(prisma)).toMatchObject({
        activo: true,
        canalVenta: 'general',
        OR: [{ marcaId: null }, { marca: { is: { activa: true } } }],
        formatos: {
          some: {
            articulo: {
              activo: true,
              precioMinoristaNeto: { not: null },
              imagenes: { some: {} },
            },
          },
        },
      });
    });

    it('E2-H1 · nunca lee el precio mayorista (RNF-04)', async () => {
      await servicio.listarProductos({});

      // Los filtros exigen que exista (E3-H2: el formato sin precios no se vende), pero
      // ningún `select` lo pide, así que nunca sale de la base
      const consulta = JSON.stringify(prisma.producto.findMany.mock.calls[0]);
      expect(consulta).not.toContain('"precioMayoristaNeto":true');
    });

    it('E3-H2 · un formato sin los dos precios no se vende en la tienda', async () => {
      await servicio.listarProductos({});

      expect(prisma.producto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            formatos: {
              some: {
                articulo: expect.objectContaining({
                  precioMinoristaNeto: { not: null },
                  precioMayoristaNeto: { not: null },
                }) as object,
              },
            },
          }) as object,
        }),
      );
    });

    it('E2-H1 · precio del formato predeterminado; si no hay, el del más barato', async () => {
      prisma.producto.findMany.mockResolvedValue([
        fila({
          formatos: [
            formato('5000', {}, 'img/chico.jpg'),
            formato('20000', { esPredeterminado: true }, 'img/grande.jpg'),
          ],
        }),
        fila({
          id: 6,
          formatos: [
            formato('8000.40', {}, 'img/b.jpg'),
            formato('3000', {}, 'img/c.jpg'),
          ],
        }),
      ]);

      const { items } = await servicio.listarProductos({});

      expect(items[0]).toMatchObject({
        precio: 23800,
        imagen: 'img/grande.jpg',
      });
      expect(items[1]).toMatchObject({ precio: 3570, imagen: 'img/c.jpg' });
    });

    it('E2-H1 · categoría sin productos: devuelve una lista vacía', async () => {
      prisma.producto.findMany.mockResolvedValue([]);
      prisma.producto.count.mockResolvedValue(0);

      const resultado = await servicio.listarProductos({ categoriaId: 4 });

      expect(resultado).toEqual({ items: [], total: 0, pagina: 1, limite: 20 });
    });

    it('E2-H1 · categoría inexistente: responde 404', async () => {
      await expect(
        servicio.listarProductos({ categoriaId: 99 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.producto.findMany).not.toHaveBeenCalled();
    });

    it('E2-H1 · navegación por marca: filtra solo los productos de esa marca', async () => {
      await servicio.listarProductos({ marcaId: 2 });

      expect(whereDe(prisma)).toMatchObject({ marcaId: 2 });
    });

    it('E2-H1 · marca inexistente o desactivada: responde 404', async () => {
      prisma.marca.findUnique.mockResolvedValueOnce(null);
      await expect(
        servicio.listarProductos({ marcaId: 99 }),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.marca.findUnique.mockResolvedValueOnce({ activa: false });
      await expect(
        servicio.listarProductos({ marcaId: 2 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.producto.findMany).not.toHaveBeenCalled();
    });

    it('E2-H1 · pagina según lo pedido', async () => {
      await servicio.listarProductos({ pagina: 3, limite: 10 });

      expect(prisma.producto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  describe('búsqueda', () => {
    /** Condición que se pide a cada palabra buscada. */
    const condicion = (palabra: string, categorias?: number[]) => ({
      OR: [
        { nombre: { contains: palabra, mode: 'insensitive' } },
        {
          marca: {
            is: { nombre: { contains: palabra, mode: 'insensitive' } },
          },
        },
        ...(categorias ? [{ categoriaId: { in: categorias } }] : []),
      ],
    });

    it('E2-H2 · búsqueda con resultados: compara el nombre y la marca sin distinguir mayúsculas', async () => {
      const resultado = await servicio.listarProductos({ buscar: 'Kera' });

      expect(whereDe(prisma)).toMatchObject({ AND: [condicion('kera')] });
      expect(resultado.items).toHaveLength(1);
    });

    it('E2-H2 · búsqueda con resultados: una categoría coincide con sus productos y los de sus subcategorías', async () => {
      await servicio.listarProductos({ buscar: 'SHAMPOO' });

      expect(whereDe(prisma)).toMatchObject({
        AND: [condicion('shampoo', [2, 3])],
      });
    });

    it('E2-H2 · búsqueda con resultados: una subcategoría coincide con sus productos', async () => {
      await servicio.listarProductos({ buscar: 'sulfato' });

      expect(whereDe(prisma)).toMatchObject({
        AND: [condicion('sulfato', [3])],
      });
    });

    it('E2-H2 · búsqueda con resultados: cada palabra debe coincidir en algún campo', async () => {
      await servicio.listarProductos({ buscar: 'shampoo   Kerastase SHAMPOO' });

      expect(whereDe(prisma)).toMatchObject({
        AND: [condicion('shampoo', [2, 3]), condicion('kerastase')],
      });
    });

    it('E2-H2 · búsqueda: %, _ y la barra invertida se escapan para buscarse como texto', async () => {
      await servicio.listarProductos({ buscar: '50%_a\\b' });

      expect(whereDe(prisma)).toMatchObject({
        AND: [
          {
            OR: [
              { nombre: { contains: '50\\%\\_a\\\\b', mode: 'insensitive' } },
              expect.anything(),
            ],
          },
        ],
      });
    });

    it('E2-H2 · búsqueda sin resultados: devuelve una lista vacía', async () => {
      prisma.producto.findMany.mockResolvedValue([]);
      prisma.producto.count.mockResolvedValue(0);

      const resultado = await servicio.listarProductos({
        buscar: 'inexistente',
      });

      expect(resultado).toEqual({ items: [], total: 0, pagina: 1, limite: 20 });
    });

    it('E2-H2 · filtros combinados: búsqueda, categoría y marca se exigen a la vez', async () => {
      await servicio.listarProductos({
        buscar: 'reparador',
        categoriaId: 2,
        marcaId: 2,
      });

      expect(whereDe(prisma)).toMatchObject({
        categoriaId: { in: [2, 3] },
        marcaId: 2,
        AND: [condicion('reparador')],
      });
      expect(prisma.categoria.findMany).toHaveBeenCalledTimes(1);
    });

    it('E2-H2 · búsqueda vacía: lista sin filtrar por texto', async () => {
      await servicio.listarProductos({ buscar: '' });

      expect(whereDe(prisma)).toMatchObject({ AND: undefined });
      expect(prisma.categoria.findMany).not.toHaveBeenCalled();
    });
  });

  describe('listarProductos según el rol (E2-H4)', () => {
    /** Formato como lo lee la consulta del profesional, con los dos precios. */
    const formatoPro = (
      minorista: string | null,
      mayorista: string,
      extra: object = {},
      imagen = 'img/a.jpg',
    ) => ({
      esPredeterminado: false,
      articulo: {
        precioMinoristaNeto: minorista,
        precioMayoristaNeto: mayorista,
        imagenes: [{ ubicacionArchivo: imagen }],
      },
      ...extra,
    });

    const consultaDe = () =>
      JSON.stringify(prisma.producto.findMany.mock.calls[0]);

    beforeEach(() => {
      prisma.producto.findMany.mockResolvedValue([
        fila({
          canalVenta: 'general',
          formatos: [formatoPro('10000', '7000')],
        }),
      ]);
    });

    it('E2-H4 · precio mayorista: el profesional recibe el mayorista con IVA y el minorista del mismo formato', async () => {
      prisma.producto.findMany.mockResolvedValue([
        fila({
          canalVenta: 'general',
          formatos: [formatoPro('10000', '7000')],
        }),
      ]);

      const { items } = await servicio.listarProductos({}, ROLES.PROFESIONAL);

      expect(items).toEqual([
        {
          id: 5,
          nombre: 'Shampoo reparador',
          marca: { id: 2, nombre: 'Kerastase' },
          categoria: { id: 3, nombre: 'Reparación' },
          precio: 11900,
          precioMayorista: 8330,
          exclusivo: false,
          imagen: 'img/a.jpg',
        },
      ]);
      expect(consultaDe()).toContain('"precioMayoristaNeto":true');
    });

    it('E2-H4 · precio mayorista: el formato se elige por el predeterminado y, si no hay, por el mayorista más barato', async () => {
      prisma.producto.findMany.mockResolvedValue([
        fila({
          canalVenta: 'general',
          formatos: [
            formatoPro('5000', '4000', {}, 'img/chico.jpg'),
            formatoPro(
              '20000',
              '15000',
              { esPredeterminado: true },
              'img/g.jpg',
            ),
          ],
        }),
        fila({
          id: 6,
          canalVenta: 'general',
          formatos: [
            // El minorista más barato no es el del mayorista más barato
            formatoPro('3000', '2900', {}, 'img/b.jpg'),
            formatoPro('3500', '2000', {}, 'img/c.jpg'),
          ],
        }),
      ]);

      const { items } = await servicio.listarProductos({}, ROLES.PROFESIONAL);

      expect(items[0]).toMatchObject({
        precio: 23800,
        precioMayorista: 17850,
        imagen: 'img/g.jpg',
      });
      expect(items[1]).toMatchObject({
        precio: 4165,
        precioMayorista: 2380,
        imagen: 'img/c.jpg',
      });
    });

    it('E2-H4 · productos exclusivos: el profesional los ve en el listado, con canal general o profesional', async () => {
      await servicio.listarProductos({}, ROLES.PROFESIONAL);

      expect(whereDe(prisma)).toMatchObject({
        activo: true,
        canalVenta: { in: ['general', 'profesional'] },
      });
    });

    it('E2-H4 · productos exclusivos: también aparecen al buscar y filtrar', async () => {
      await servicio.listarProductos(
        { buscar: 'shampoo', categoriaId: 1, marcaId: 2 },
        ROLES.PROFESIONAL,
      );

      expect(whereDe(prisma)).toMatchObject({
        canalVenta: { in: ['general', 'profesional'] },
        categoriaId: { in: [1, 2, 3] },
        marcaId: 2,
        AND: [expect.any(Object)],
      });
    });

    it('E2-H4 · productos exclusivos: se venden con solo el precio mayorista; el general sigue exigiendo los dos', async () => {
      await servicio.listarProductos({}, ROLES.PROFESIONAL);

      expect(whereDe(prisma)).toMatchObject({
        formatos: {
          some: {
            articulo: {
              activo: true,
              precioMayoristaNeto: { not: null },
              imagenes: { some: {} },
            },
            OR: [
              { producto: { canalVenta: 'profesional' } },
              { articulo: { precioMinoristaNeto: { not: null } } },
            ],
          },
        },
      });
    });

    it('E2-H4 · productos exclusivos: van marcados y sin precio minorista, aunque tengan uno guardado', async () => {
      prisma.producto.findMany.mockResolvedValue([
        fila({
          canalVenta: 'profesional',
          formatos: [formatoPro('10000', '7000')],
        }),
        fila({
          id: 6,
          canalVenta: 'profesional',
          formatos: [formatoPro(null, '5000')],
        }),
      ]);

      const { items } = await servicio.listarProductos({}, ROLES.PROFESIONAL);

      expect(items[0]).toMatchObject({
        precio: null,
        precioMayorista: 8330,
        exclusivo: true,
      });
      expect(items[1]).toMatchObject({
        precio: null,
        precioMayorista: 5950,
        exclusivo: true,
      });
    });

    it.each([
      ['visitante', undefined],
      ['cliente', ROLES.CLIENTE],
      ['vendedor', ROLES.VENDEDOR],
      ['bodeguero', ROLES.BODEGUERO],
      ['administrador', ROLES.ADMINISTRADOR],
    ])(
      'E2-H4 · usuario no verificado (%s): solo venta general, sin leer ni enviar el precio mayorista',
      async (_nombre, rol) => {
        const { items } = await servicio.listarProductos({}, rol);

        expect(whereDe(prisma)).toMatchObject({ canalVenta: 'general' });
        expect(consultaDe()).not.toContain('"precioMayoristaNeto":true');
        expect(consultaDe()).not.toContain('"canalVenta":true');
        expect(Object.keys(items[0]!).sort()).toEqual([
          'categoria',
          'id',
          'imagen',
          'marca',
          'nombre',
          'precio',
        ]);
      },
    );
  });

  describe('categorías y marcas', () => {
    it('E2-H1 · árbol de categorías: se lee a través de la caché', async () => {
      await servicio.listarCategorias();

      expect(cache.obtener).toHaveBeenCalledWith(
        'cache:tienda:categorias',
        expect.any(Function),
      );
      expect(categorias.listarArbol).toHaveBeenCalled();
    });

    it('E2-H1 · marcas: solo las activas, con id y nombre, a través de la caché', async () => {
      const resultado = await servicio.listarMarcas();

      expect(marcas.listar).toHaveBeenCalledWith();
      expect(resultado).toEqual([{ id: 2, nombre: 'Kerastase' }]);
      expect(cache.obtener).toHaveBeenCalledWith(
        'cache:tienda:marcas',
        expect.any(Function),
      );
    });
  });
});
