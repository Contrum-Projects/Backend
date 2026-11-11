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
  id: 41,
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
  marca: { count: vi.fn().mockResolvedValue(1) },
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
      await servicio.listarProductos({ categoriaId: [1] });

      expect(whereDe(prisma)).toMatchObject({
        categoriaId: { in: [1, 2, 3] },
      });
    });

    it('E2-H1 · categoría con productos: devuelve imagen, nombre y precio minorista con IVA', async () => {
      const resultado = await servicio.listarProductos({ categoriaId: [3] });

      expect(resultado).toEqual({
        items: [
          {
            id: 5,
            nombre: 'Shampoo reparador',
            marca: { id: 2, nombre: 'Kerastase' },
            categoria: { id: 3, nombre: 'Reparación' },
            precio: 11900,
            imagen: 'img/a.jpg',
            formatoId: 41,
            formatos: 1,
          },
        ],
        total: 1,
        pagina: 1,
        limite: 20,
      });
    });

    it('SCRUM-157 · cada producto trae el formato que muestra y cuántos formatos hay a la venta', async () => {
      prisma.producto.findMany.mockResolvedValue([
        fila({
          formatos: [
            { ...formato('5000'), id: 51 },
            { ...formato('9000', { esPredeterminado: true }), id: 52 },
          ],
        }),
        fila({ id: 6, formatos: [{ ...formato('7000'), id: 61 }] }),
      ]);

      const { items } = await servicio.listarProductos({});

      expect(
        items.map(({ formatoId, formatos }) => ({ formatoId, formatos })),
      ).toEqual([
        { formatoId: 52, formatos: 2 },
        { formatoId: 61, formatos: 1 },
      ]);
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
        const { items } = await servicio.listarProductos({ categoriaId: [3] });

        expect(items[0].imagen).toBe(
          'https://imagenes.cabelloperfecto.cl/img/a.jpg',
        );
      } finally {
        delete variables.R2_URL_PUBLICA;
      }
    });

    it('E2-H1 · solo productos activos, de venta general, con marca activa y un formato vendible', async () => {
      await servicio.listarProductos({ categoriaId: [3] });

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

      const resultado = await servicio.listarProductos({ categoriaId: [4] });

      expect(resultado).toEqual({ items: [], total: 0, pagina: 1, limite: 20 });
    });

    it('E2-H1 · categoría inexistente: responde 404', async () => {
      await expect(
        servicio.listarProductos({ categoriaId: [99] }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.producto.findMany).not.toHaveBeenCalled();
    });

    it('E2-H1 · navegación por marca: filtra solo los productos de esa marca', async () => {
      await servicio.listarProductos({ marcaId: [2] });

      expect(whereDe(prisma)).toMatchObject({ marcaId: { in: [2] } });
    });

    it('E2-H1 · marca inexistente o desactivada: responde 404', async () => {
      // Sin marca activa con ese id (no existe o está desactivada)
      prisma.marca.count.mockResolvedValueOnce(0);
      await expect(
        servicio.listarProductos({ marcaId: [99] }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.marca.count).toHaveBeenCalledWith({
        where: { id: { in: [99] }, activa: true },
      });
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
        categoriaId: [2],
        marcaId: [2],
      });

      expect(whereDe(prisma)).toMatchObject({
        categoriaId: { in: [2, 3] },
        marcaId: { in: [2] },
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
      id: 41,
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
          formatoId: 41,
          formatos: 1,
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
        { buscar: 'shampoo', categoriaId: [1], marcaId: [2] },
        ROLES.PROFESIONAL,
      );

      expect(whereDe(prisma)).toMatchObject({
        canalVenta: { in: ['general', 'profesional'] },
        categoriaId: { in: [1, 2, 3] },
        marcaId: { in: [2] },
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
          'formatoId',
          'formatos',
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

  describe('varias categorías y marcas (SCRUM-150)', () => {
    it('E2-H2 · dentro de un grupo basta una: categorías con sus subcategorías y marcas en lista', async () => {
      prisma.marca.count.mockResolvedValueOnce(2);

      await servicio.listarProductos({ categoriaId: [2, 4], marcaId: [2, 7] });

      expect(whereDe(prisma)).toMatchObject({
        categoriaId: { in: [2, 4, 3] },
        marcaId: { in: [2, 7] },
      });
    });

    it('E2-H2 · un id repetido cuenta una vez y uno inexistente responde 404', async () => {
      await servicio.listarProductos({ marcaId: [2, 2] });
      expect(prisma.marca.count).toHaveBeenCalledWith({
        where: { id: { in: [2] }, activa: true },
      });

      await expect(
        servicio.listarProductos({ categoriaId: [2, 99] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('facetas (SCRUM-150)', () => {
    const conGrupos = (
      porCategoria: { categoriaId: number; total: number }[],
      porMarca: { marcaId: number | null; total: number }[],
    ) => {
      const groupBy = vi
        .fn()
        .mockResolvedValueOnce(
          porCategoria.map(({ categoriaId, total }) => ({
            categoriaId,
            _count: { _all: total },
          })),
        )
        .mockResolvedValueOnce(
          porMarca.map(({ marcaId, total }) => ({
            marcaId,
            _count: { _all: total },
          })),
        );
      (prisma.producto as unknown as { groupBy: typeof groupBy }).groupBy =
        groupBy;
      return groupBy;
    };

    it('E2-H2 · conteos: la categoría suma sus subcategorías y solo vienen las que tienen productos', async () => {
      conGrupos(
        [
          { categoriaId: 2, total: 3 },
          { categoriaId: 3, total: 2 },
        ],
        [{ marcaId: 2, total: 5 }],
      );

      await expect(servicio.facetas({})).resolves.toEqual({
        // Cuidado (1) > Shampoo (2) > Sin sulfato (3); Coloración (4) no tiene
        categorias: [
          { id: 1, total: 5 },
          { id: 2, total: 5 },
          { id: 3, total: 2 },
        ],
        marcas: [{ id: 2, total: 5 }],
      });
    });

    it('E2-H2 · cada grupo cuenta con los filtros del otro, no con los suyos', async () => {
      const groupBy = conGrupos([], []);
      prisma.marca.count.mockResolvedValueOnce(1);

      await servicio.facetas({ categoriaId: [4], marcaId: [2] });

      const [porCategoria, porMarca] = groupBy.mock.calls.map(
        ([argumentos]) => (argumentos as { where: object }).where,
      );
      // Las categorías: con la marca, sin la categoría marcada
      expect(porCategoria).toMatchObject({
        categoriaId: undefined,
        marcaId: { in: [2] },
      });
      // Las marcas: con la categoría, sin la marca marcada (y sin productos sin marca)
      expect(porMarca).toMatchObject({
        categoriaId: { in: [4] },
        marcaId: { not: null },
      });
    });

    it('RNF-04 · el visitante solo cuenta productos de venta general; el profesional, también los exclusivos', async () => {
      const groupBy = conGrupos([], []);
      await servicio.facetas({});
      expect(
        (groupBy.mock.calls[0][0] as { where: object }).where,
      ).toMatchObject({ canalVenta: 'general' });

      const otro = conGrupos([], []);
      await servicio.facetas({}, ROLES.PROFESIONAL);
      expect((otro.mock.calls[0][0] as { where: object }).where).toMatchObject({
        canalVenta: { in: ['general', 'profesional'] },
      });
    });
  });

  describe('orden (SCRUM-150)', () => {
    it('E2-H1 · novedades: el creado más recientemente primero, y sin orden por nombre', async () => {
      await servicio.listarProductos({ orden: 'novedades' });
      await servicio.listarProductos({});

      const ordenDe = (llamada: number) =>
        (
          prisma.producto.findMany.mock.calls[llamada][0] as {
            orderBy: unknown;
          }
        ).orderBy;
      expect(ordenDe(0)).toEqual([
        { fechaCreacion: 'desc' },
        { nombre: 'asc' },
        { id: 'asc' },
      ]);
      expect(ordenDe(1)).toEqual([{ nombre: 'asc' }, { id: 'asc' }]);
    });

    it('E2-H1 · más vendidos: por unidades vendidas, los empates por nombre, y pagina sobre ese orden', async () => {
      // Los que cumplen los filtros, por nombre; luego la página pedida
      prisma.producto.findMany
        .mockResolvedValueOnce([
          { id: 1, nombre: 'A' },
          { id: 2, nombre: 'B' },
          { id: 3, nombre: 'C' },
          { id: 4, nombre: 'D' },
        ])
        .mockResolvedValueOnce([fila({ id: 1 }), fila({ id: 4 })]);
      const queryRaw = vi.fn().mockResolvedValue([
        { productoId: 3, unidades: 5n },
        { productoId: 2, unidades: 3n },
      ]);
      (prisma as unknown as { $queryRaw: typeof queryRaw }).$queryRaw =
        queryRaw;

      const { items } = await servicio.listarProductos({
        orden: 'mas-vendidos',
        pagina: 2,
        limite: 2,
      });

      // Orden: C (5), B (3), A, D; la página 2 es A y D, en ese orden
      expect(prisma.producto.findMany.mock.calls[1][0]).toMatchObject({
        where: { id: { in: [1, 4] } },
      });
      expect(items.map((item) => item.id)).toEqual([1, 4]);
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });
  });
});
