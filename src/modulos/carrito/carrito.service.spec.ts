import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { precioConIva } from '../../common/dominio/montos.js';
import { ROLES } from '../../common/dominio/roles.js';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { CarritoService } from './carrito.service.js';
import { MAXIMO_UNIDADES_LINEA } from './dto/articulo-carrito.dto.js';

const CODIGO = '3f0c2a52-0b9e-4c55-9d0e-6a3a4f6d1b2c';
const IVA = 19;

/** Una línea del carrito como la lee la base: un formato de un producto. */
const lineaFormato = (articuloId: number, cantidad: number) => ({
  articuloId,
  cantidad,
  articulo: {
    tipo: 'formato',
    imagenes: [{ ubicacionArchivo: `articulos/${articuloId}/principal.jpg` }],
    formato: { nombreFormato: '300 ml', producto: { nombre: 'Shampoo' } },
    pack: null,
  },
});

const lineaPack = (articuloId: number, cantidad: number) => ({
  articuloId,
  cantidad,
  articulo: {
    tipo: 'pack',
    imagenes: [],
    formato: null,
    pack: { nombre: 'Dúo reparador' },
  },
});

const crearDb = () => {
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 7 }]),
    carrito: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({ id: 70 }),
      upsert: vi.fn().mockResolvedValue({ id: 70 }),
      update: vi.fn().mockResolvedValue({ id: 70 }),
    },
    itemCarrito: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    formatoProducto: { findMany: vi.fn().mockResolvedValue([]) },
    pack: { findMany: vi.fn().mockResolvedValue([]) },
    existencia: { groupBy: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((fn: (t: typeof db) => Promise<unknown>) =>
    fn(db),
  );
  return db;
};

const crearServicio = (db: ReturnType<typeof crearDb>) => {
  const config = {
    get: (clave: string) =>
      ({ IVA_PORCENTAJE: IVA, R2_URL_PUBLICA: 'https://cdn.test' })[clave],
  };
  return new CarritoService(
    db as unknown as PrismaService,
    config as unknown as ConfigService<Entorno, true>,
  );
};

/** El formato `id` se vende a minoristas a `neto`, con `unidades` en la bodega online. */
const venderFormato = (
  db: ReturnType<typeof crearDb>,
  id: number,
  neto: number,
  unidades: number,
) => {
  const precios = { precioMinoristaNeto: neto, precioMayoristaNeto: neto };
  db.formatoProducto.findMany.mockResolvedValue([{ id, articulo: precios }]);
  db.existencia.groupBy.mockResolvedValue([
    { formatoId: id, _sum: { cantidad: unidades } },
  ]);
};

describe('CarritoService', () => {
  let db: ReturnType<typeof crearDb>;
  let servicio: CarritoService;

  beforeEach(() => {
    db = crearDb();
    servicio = crearServicio(db);
  });

  describe('obtener', () => {
    it('sin carrito responde vacío y no consulta la tienda', async () => {
      const carrito = await servicio.obtener(CODIGO, ROLES.CLIENTE);

      expect(carrito).toEqual({
        items: [],
        total: 0,
        puedeCrearPedido: false,
      });
      expect(db.carrito.findFirst.mock.calls[0][0].where).toEqual({
        usuario: { codigoPublico: CODIGO },
      });
      expect(db.formatoProducto.findMany).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('E5-H1 · totales: precio con IVA por unidad (la misma función de la tienda) y suma de subtotales', async () => {
      db.carrito.findFirst.mockResolvedValue({
        items: [lineaFormato(11, 3)],
      });
      venderFormato(db, 11, 10000.4, 5);

      const carrito = await servicio.obtener(CODIGO, ROLES.CLIENTE);

      const unitario = precioConIva(10000.4, IVA);
      expect(carrito).toEqual({
        items: [
          {
            articuloId: 11,
            tipo: 'formato',
            nombre: 'Shampoo',
            nombreFormato: '300 ml',
            imagen: 'https://cdn.test/articulos/11/principal.jpg',
            cantidad: 3,
            precioUnitario: unitario,
            subtotal: unitario * 3,
            aLaVenta: true,
            stockSuficiente: true,
            impideCrearPedido: false,
          },
        ],
        total: unitario * 3,
        puedeCrearPedido: true,
      });
    });

    it('E5-H1 · cantidad mayor al stock: señala la línea, impide crear el pedido y no dice cuántas hay', async () => {
      db.carrito.findFirst.mockResolvedValue({
        items: [lineaFormato(11, 3)],
      });
      venderFormato(db, 11, 10000, 2);

      const carrito = await servicio.obtener(CODIGO, ROLES.CLIENTE);

      expect(carrito.items[0]).toMatchObject({
        stockSuficiente: false,
        impideCrearPedido: true,
      });
      expect(carrito.puedeCrearPedido).toBe(false);
      expect(JSON.stringify(carrito)).not.toContain('"stock":');
    });

    it('un artículo que ya no se vende queda sin precio, fuera del total y con el pedido impedido', async () => {
      db.carrito.findFirst.mockResolvedValue({
        items: [lineaFormato(11, 1), lineaFormato(12, 2)],
      });
      venderFormato(db, 11, 10000, 5);

      const carrito = await servicio.obtener(CODIGO, ROLES.CLIENTE);

      expect(carrito.items[1]).toMatchObject({
        articuloId: 12,
        aLaVenta: false,
        precioUnitario: null,
        subtotal: null,
        stockSuficiente: null,
        impideCrearPedido: true,
      });
      expect(carrito.total).toBe(precioConIva(10000, IVA));
      expect(carrito.puedeCrearPedido).toBe(false);
    });

    it('el stock de un pack lo marca su componente más escaso, contando cuántas unidades lleva', async () => {
      db.carrito.findFirst.mockResolvedValue({ items: [lineaPack(30, 2)] });
      db.pack.findMany.mockResolvedValue([
        {
          id: 30,
          articulo: { precioMinoristaNeto: 15000 },
          componentes: [
            { formatoId: 11, cantidad: 1 },
            { formatoId: 12, cantidad: 2 },
          ],
        },
      ]);
      db.existencia.groupBy.mockResolvedValue([
        { formatoId: 11, _sum: { cantidad: 50 } },
        { formatoId: 12, _sum: { cantidad: 5 } },
      ]);

      const carrito = await servicio.obtener(CODIGO, ROLES.CLIENTE);

      // 5 unidades del formato 12 y 2 por pack: caben 2 packs, justo lo que pide
      expect(carrito.items[0]).toMatchObject({
        tipo: 'pack',
        nombre: 'Dúo reparador',
        nombreFormato: null,
        imagen: null,
        stockSuficiente: true,
      });
    });

    it('RNF-04 · al cliente no se le lee el precio mayorista; el profesional paga el mayorista', async () => {
      db.carrito.findFirst.mockResolvedValue({
        items: [lineaFormato(11, 1)],
      });
      venderFormato(db, 11, 10000, 5);

      await servicio.obtener(CODIGO, ROLES.CLIENTE);
      const paraCliente = db.formatoProducto.findMany.mock.calls[0][0];
      expect(paraCliente.select.articulo.select).toEqual({
        precioMinoristaNeto: true,
      });
      const paraClientePack = db.pack.findMany.mock.calls[0][0];
      expect(paraClientePack.select.articulo.select).toEqual({
        precioMinoristaNeto: true,
      });

      db.formatoProducto.findMany.mockClear();
      db.pack.findMany.mockClear();
      db.formatoProducto.findMany.mockResolvedValue([
        { id: 11, articulo: { precioMayoristaNeto: 8000 } },
      ]);
      const carrito = await servicio.obtener(CODIGO, ROLES.PROFESIONAL);
      expect(
        db.formatoProducto.findMany.mock.calls[0][0].select.articulo.select,
      ).toEqual({ precioMayoristaNeto: true });
      expect(carrito.items[0]!.precioUnitario).toBe(precioConIva(8000, IVA));
    });
  });

  describe('agregar', () => {
    it('E5-H1 · artículo agregado: crea el carrito de la cuenta, guarda la cantidad y devuelve el carrito', async () => {
      venderFormato(db, 11, 10000, 5);

      await servicio.agregar(CODIGO, ROLES.CLIENTE, {
        articuloId: 11,
        cantidad: 2,
      });

      expect(db.$queryRaw).toHaveBeenCalled();
      expect(db.carrito.upsert.mock.calls[0][0]).toMatchObject({
        where: { usuarioId: 7 },
        create: { usuarioId: 7 },
      });
      expect(db.itemCarrito.upsert.mock.calls[0][0]).toMatchObject({
        create: { carritoId: 70, articuloId: 11, cantidad: 2 },
        update: { cantidad: 2 },
      });
      expect(db.carrito.findFirst).toHaveBeenCalled();
    });

    it('suma las unidades a las que ya había', async () => {
      venderFormato(db, 11, 10000, 5);
      db.itemCarrito.findUnique.mockResolvedValue({ cantidad: 2 });

      await servicio.agregar(CODIGO, ROLES.CLIENTE, {
        articuloId: 11,
        cantidad: 2,
      });

      expect(db.itemCarrito.upsert.mock.calls[0][0].update).toEqual({
        cantidad: 4,
      });
    });

    it('E5-H1 · sin stock suficiente para la cantidad total: 400 y no guarda', async () => {
      venderFormato(db, 11, 10000, 3);
      db.itemCarrito.findUnique.mockResolvedValue({ cantidad: 2 });

      await expect(
        servicio.agregar(CODIGO, ROLES.CLIENTE, {
          articuloId: 11,
          cantidad: 2,
        }),
      ).rejects.toThrow(
        new BadRequestException('No hay stock suficiente para esa cantidad.'),
      );
      expect(db.itemCarrito.upsert).not.toHaveBeenCalled();
    });

    it('un artículo que la tienda no vende a esa cuenta responde 400', async () => {
      await expect(
        servicio.agregar(CODIGO, ROLES.CLIENTE, {
          articuloId: 99,
          cantidad: 1,
        }),
      ).rejects.toThrow(
        new BadRequestException('El artículo no existe o no está a la venta.'),
      );
      expect(db.carrito.upsert).not.toHaveBeenCalled();
    });

    it(`una línea no pasa de ${MAXIMO_UNIDADES_LINEA} unidades en total`, async () => {
      venderFormato(db, 11, 10000, 5000);
      db.itemCarrito.findUnique.mockResolvedValue({ cantidad: 990 });

      await expect(
        servicio.agregar(CODIGO, ROLES.CLIENTE, {
          articuloId: 11,
          cantidad: 10,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(db.itemCarrito.upsert).not.toHaveBeenCalled();
    });
  });

  describe('cambiarCantidad', () => {
    it('E5-H1 · deja la cantidad indicada y marca el carrito como actualizado', async () => {
      db.itemCarrito.findUnique.mockResolvedValue({ articuloId: 11 });
      venderFormato(db, 11, 10000, 5);

      await servicio.cambiarCantidad(CODIGO, ROLES.CLIENTE, 11, {
        cantidad: 4,
      });

      expect(db.itemCarrito.update.mock.calls[0][0]).toMatchObject({
        data: { cantidad: 4 },
      });
      expect(db.carrito.update.mock.calls[0][0].data).toHaveProperty(
        'fechaActualizacion',
      );
    });

    it('un artículo que no está en el carrito responde 404', async () => {
      await expect(
        servicio.cambiarCantidad(CODIGO, ROLES.CLIENTE, 11, { cantidad: 1 }),
      ).rejects.toThrow(
        new NotFoundException('El artículo no está en el carrito.'),
      );
      expect(db.itemCarrito.update).not.toHaveBeenCalled();
    });

    it('un artículo que ya no se vende pide quitarlo', async () => {
      db.itemCarrito.findUnique.mockResolvedValue({ articuloId: 11 });

      await expect(
        servicio.cambiarCantidad(CODIGO, ROLES.CLIENTE, 11, { cantidad: 1 }),
      ).rejects.toThrow(
        new BadRequestException(
          'El artículo ya no está a la venta: quítalo del carrito.',
        ),
      );
    });

    it('sin stock para la cantidad nueva: 400 y no cambia', async () => {
      db.itemCarrito.findUnique.mockResolvedValue({ articuloId: 11 });
      venderFormato(db, 11, 10000, 2);

      await expect(
        servicio.cambiarCantidad(CODIGO, ROLES.CLIENTE, 11, { cantidad: 3 }),
      ).rejects.toThrow(BadRequestException);
      expect(db.itemCarrito.update).not.toHaveBeenCalled();
    });
  });

  describe('quitar', () => {
    it('E5-H1 · artículo quitado: lo elimina del carrito de la cuenta, se venda o no', async () => {
      db.itemCarrito.findUnique.mockResolvedValue({ articuloId: 11 });

      await servicio.quitar(CODIGO, ROLES.CLIENTE, 11);

      expect(db.itemCarrito.delete.mock.calls[0][0].where).toEqual({
        carritoId_articuloId: { carritoId: 70, articuloId: 11 },
      });
      expect(db.carrito.update).toHaveBeenCalled();
    });

    it('sin carrito o con un artículo que no está: 404', async () => {
      db.carrito.findUnique.mockResolvedValue(null);
      await expect(servicio.quitar(CODIGO, ROLES.CLIENTE, 11)).rejects.toThrow(
        NotFoundException,
      );

      db.carrito.findUnique.mockResolvedValue({ id: 70 });
      await expect(servicio.quitar(CODIGO, ROLES.CLIENTE, 11)).rejects.toThrow(
        NotFoundException,
      );
      expect(db.itemCarrito.delete).not.toHaveBeenCalled();
    });
  });
});
