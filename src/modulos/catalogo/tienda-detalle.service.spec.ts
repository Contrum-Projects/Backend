import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { hoyEnLaTienda } from '../../common/dominio/fechas.js';
import { precioConIva } from '../../common/dominio/montos.js';
import type { Entorno } from '../../config/entorno.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { EXISTENCIA_VENDIBLE } from './disponibilidad.js';
import { TiendaDetalleService } from './tienda-detalle.service.js';
import { packsGenerales, packsProfesional } from './tienda-packs.service.js';
import { productoALaVenta } from './tienda.service.js';

const URL_BASE = 'https://imagenes.cabelloperfecto.cl';

const formato = (id: number, extra: object = {}) => ({
  id,
  nombreFormato: `${id} ml`,
  contenido: new Prisma.Decimal(300),
  unidadMedida: 'ml',
  esPredeterminado: id === 10,
  articulo: {
    precioMinoristaNeto: new Prisma.Decimal(10_000),
    precioMayoristaNeto: new Prisma.Decimal(8_000),
    imagenes: [
      { ubicacionArchivo: `articulos/${id}/principal.jpg` },
      { ubicacionArchivo: `articulos/${id}/reverso.jpg` },
    ],
  },
  ...extra,
});

const producto = (extra: object = {}) => ({
  id: 1,
  nombre: 'Shampoo reparador',
  descripcion: 'Repara el cabello.',
  canalVenta: 'general',
  marca: { id: 2, nombre: 'Loreal' },
  categoria: { id: 3, nombre: 'Shampoo' },
  formatos: [formato(10), formato(11)],
  ...extra,
});

const pack = (extra: object = {}) => ({
  id: 30,
  nombre: 'Dúo reparador',
  descripcion: 'Shampoo y acondicionador.',
  fechaFinVigencia: null,
  canalVenta: 'general',
  articulo: {
    precioMinoristaNeto: new Prisma.Decimal(15_000),
    precioMayoristaNeto: new Prisma.Decimal(12_000),
    imagenes: [
      { ubicacionArchivo: 'articulos/30/principal.jpg' },
      { ubicacionArchivo: 'articulos/30/detalle.jpg' },
    ],
  },
  componentes: [
    {
      formatoId: 10,
      cantidad: 1,
      formato: {
        nombreFormato: '300 ml',
        producto: { nombre: 'Shampoo reparador' },
      },
    },
    {
      formatoId: 12,
      cantidad: 2,
      formato: {
        nombreFormato: '250 ml',
        producto: { nombre: 'Acondicionador' },
      },
    },
  ],
  ...extra,
});

const config = {
  get: vi.fn((clave: string) => (clave === 'IVA_PORCENTAJE' ? 19 : URL_BASE)),
} as unknown as ConfigService<Entorno, true>;

/** `stock` simula el resultado agrupado de EXISTENCIA vendible por formato. */
const crearPrisma = (stock: Record<number, number> = {}) => ({
  producto: { findFirst: vi.fn().mockResolvedValue(producto()) },
  pack: { findFirst: vi.fn().mockResolvedValue(pack()) },
  existencia: {
    groupBy: vi.fn().mockResolvedValue(
      Object.entries(stock).map(([formatoId, cantidad]) => ({
        formatoId: Number(formatoId),
        _sum: { cantidad },
      })),
    ),
  },
});

type ArgumentosConsulta = {
  where: Record<string, unknown>;
  select: Record<string, unknown>;
};

describe('TiendaDetalleService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let servicio: TiendaDetalleService;

  const iniciar = (stock?: Record<number, number>) => {
    prisma = crearPrisma(stock);
    servicio = new TiendaDetalleService(
      prisma as unknown as PrismaService,
      config,
    );
  };

  const consultaProducto = () =>
    prisma.producto.findFirst.mock.calls[0]![0] as ArgumentosConsulta;
  const consultaPack = () =>
    prisma.pack.findFirst.mock.calls[0]![0] as ArgumentosConsulta;

  beforeEach(() => iniciar());

  describe('obtenerProducto', () => {
    it('E2-H3 · formato con stock: devuelve sus imágenes, el precio con IVA incluido y disponible', async () => {
      iniciar({ 10: 5, 11: 1 });

      const detalle = await servicio.obtenerProducto(1);

      expect(detalle.formatos[0]).toEqual({
        id: 10,
        nombre: '10 ml',
        contenido: 300,
        unidadMedida: 'ml',
        esPredeterminado: true,
        imagenes: [
          `${URL_BASE}/articulos/10/principal.jpg`,
          `${URL_BASE}/articulos/10/reverso.jpg`,
        ],
        precio: precioConIva(10_000, 19),
        disponibilidad: 'disponible',
      });
      expect(detalle.formatos[1]!.disponibilidad).toBe('disponible');
      expect(prisma.existencia.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { formatoId: { in: [10, 11] }, ...EXISTENCIA_VENDIBLE },
        }),
      );
    });

    it('E2-H3 · formato sin stock: lo devuelve como agotado, junto a los que sí tienen', async () => {
      iniciar({ 10: 3, 11: 0 });

      const detalle = await servicio.obtenerProducto(1);

      expect(
        detalle.formatos.map(({ id, disponibilidad }) => [id, disponibilidad]),
      ).toEqual([
        [10, 'disponible'],
        [11, 'agotado'],
      ]);
    });

    it('E2-H3 · formato sin stock: sin existencias vendibles también es agotado', async () => {
      const detalle = await servicio.obtenerProducto(1);

      expect(
        detalle.formatos.every((f) => f.disponibilidad === 'agotado'),
      ).toBe(true);
    });

    it('E2-H3 · usa la misma regla del listado: solo el producto a la venta y sus formatos vendibles, el predeterminado primero', async () => {
      await servicio.obtenerProducto(1);

      const { where, select } = consultaProducto();
      expect(where).toEqual({ id: 1, ...productoALaVenta(false) });
      expect(select.formatos).toMatchObject({
        orderBy: [{ esPredeterminado: 'desc' }, { id: 'asc' }],
      });
    });

    it('E2-H3 · visitante y cliente: la consulta no lee el precio mayorista y la respuesta no lo trae (RNF-04)', async () => {
      for (const rol of [undefined, 'cliente', 'vendedor'] as const) {
        prisma.producto.findFirst.mockClear();
        const detalle = await servicio.obtenerProducto(1, rol);

        expect(JSON.stringify(consultaProducto().select)).not.toContain(
          '"precioMayoristaNeto":true',
        );
        expect(consultaProducto().where).toEqual({
          id: 1,
          ...productoALaVenta(false),
        });
        expect(detalle).not.toHaveProperty('exclusivo');
        for (const f of detalle.formatos) {
          expect(f).not.toHaveProperty('precioMayorista');
        }
      }
    });

    it('E2-H3 · profesional: cada formato trae el mayorista con IVA; un exclusivo no muestra el minorista', async () => {
      prisma.producto.findFirst.mockResolvedValue(
        producto({ canalVenta: 'profesional' }),
      );

      const detalle = await servicio.obtenerProducto(1, 'profesional');

      expect(consultaProducto().where).toEqual({
        id: 1,
        ...productoALaVenta(true),
      });
      expect(detalle).toMatchObject({ exclusivo: true });
      expect(detalle).not.toHaveProperty('canalVenta');
      expect(detalle.formatos[0]).toMatchObject({
        precio: null,
        precioMayorista: precioConIva(8_000, 19),
      });
    });

    it('E2-H3 · profesional en un producto general: recibe los dos precios del formato', async () => {
      const detalle = await servicio.obtenerProducto(1, 'profesional');

      expect(detalle).toMatchObject({ exclusivo: false });
      expect(detalle.formatos[0]).toMatchObject({
        precio: precioConIva(10_000, 19),
        precioMayorista: precioConIva(8_000, 19),
      });
    });

    it('E2-H3 · producto que la tienda no muestra (inactivo, sin formatos vendibles o exclusivo): 404', async () => {
      prisma.producto.findFirst.mockResolvedValue(null);

      await expect(servicio.obtenerProducto(1)).rejects.toThrow(
        new NotFoundException('El producto no existe.'),
      );
      expect(prisma.existencia.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('obtenerPack', () => {
    it('E2-H3 · disponibilidad de un pack: es la de su componente más escaso', async () => {
      // El acondicionador va 2 veces por pack: 4 unidades alcanzan para 2 packs
      iniciar({ 10: 50, 12: 4 });

      const detalle = await servicio.obtenerPack(30);

      expect(detalle.disponibilidad).toBe('disponible');
      expect(prisma.existencia.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { formatoId: { in: [10, 12] }, ...EXISTENCIA_VENDIBLE },
        }),
      );
    });

    it('E2-H3 · disponibilidad de un pack: si su componente más escaso no alcanza, el pack está agotado', async () => {
      // Hay 1 acondicionador y el pack lleva 2
      iniciar({ 10: 50, 12: 1 });

      expect((await servicio.obtenerPack(30)).disponibilidad).toBe('agotado');
    });

    it('E2-H3 · pack: devuelve sus imágenes, el precio con IVA y sus componentes', async () => {
      iniciar({ 10: 1, 12: 2 });

      const detalle = await servicio.obtenerPack(30);

      expect(detalle).toEqual({
        id: 30,
        nombre: 'Dúo reparador',
        descripcion: 'Shampoo y acondicionador.',
        imagen: `${URL_BASE}/articulos/30/principal.jpg`,
        imagenes: [
          `${URL_BASE}/articulos/30/principal.jpg`,
          `${URL_BASE}/articulos/30/detalle.jpg`,
        ],
        precio: precioConIva(15_000, 19),
        vigenteHasta: null,
        componentes: [
          { producto: 'Shampoo reparador', formato: '300 ml', cantidad: 1 },
          { producto: 'Acondicionador', formato: '250 ml', cantidad: 2 },
        ],
        disponibilidad: 'disponible',
      });
    });

    it('E2-H3 · usa la misma regla del listado de packs: vigente hoy y sin el mayorista para quien no es profesional (RNF-04)', async () => {
      const detalle = await servicio.obtenerPack(30, 'cliente');

      expect(consultaPack().where).toEqual({
        id: 30,
        ...packsGenerales(hoyEnLaTienda()),
      });
      expect(JSON.stringify(consultaPack().select)).not.toContain(
        '"precioMayoristaNeto":true',
      );
      expect(detalle).not.toHaveProperty('precioMayorista');
    });

    it('E2-H3 · profesional: ve los exclusivos con el mayorista y sin el minorista', async () => {
      prisma.pack.findFirst.mockResolvedValue(
        pack({ canalVenta: 'profesional' }),
      );

      const detalle = await servicio.obtenerPack(30, 'profesional');

      expect(consultaPack().where).toEqual({
        id: 30,
        ...packsProfesional(hoyEnLaTienda()),
      });
      expect(detalle).toMatchObject({
        precio: null,
        precioMayorista: precioConIva(12_000, 19),
        exclusivo: true,
      });
    });

    it('E2-H3 · pack que la tienda no muestra (fuera de vigencia, exclusivo o sin precios): 404', async () => {
      prisma.pack.findFirst.mockResolvedValue(null);

      await expect(servicio.obtenerPack(30)).rejects.toThrow(
        new NotFoundException('El pack no existe.'),
      );
    });
  });
});
