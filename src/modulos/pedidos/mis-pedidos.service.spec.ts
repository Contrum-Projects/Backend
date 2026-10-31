import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { precioConIva } from '../../common/dominio/montos.js';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { MisPedidosService } from './mis-pedidos.service.js';

const CUENTA = '3f0c2a52-0b9e-4c55-9d0e-6a3a4f6d1b2c';
const CODIGO = 'AB12CD34EF56';
const IVA = 19;

const crearDb = () => ({
  pedido: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
  },
});

const crearServicio = (db: ReturnType<typeof crearDb>) => {
  const config = {
    get: (clave: string) => ({ R2_URL_PUBLICA: 'https://cdn.test' })[clave],
  };
  return new MisPedidosService(
    db as unknown as PrismaService,
    config as unknown as ConfigService<Entorno, true>,
  );
};

/** Un pedido como lo lee la base, con una línea de formato, retiro y un solo cambio de estado. */
const filaPedido = (cambios: Record<string, unknown> = {}) => ({
  codigoPublico: CODIGO,
  fechaPedido: new Date('2026-10-20T15:00:00Z'),
  fechaExpiracionPago: new Date('2026-10-20T15:15:00Z'),
  estadoActual: 'pagado',
  tipoEntrega: 'retiro',
  tipoDocumentoSolicitado: 'boleta',
  porcentajeIva: '19',
  montoNeto: 20000,
  montoIva: 3800,
  montoTotal: 23800,
  detalles: [
    {
      articuloId: 11,
      cantidad: 2,
      precioUnitarioNetoAplicado: '10000.40',
      articulo: {
        tipo: 'formato',
        imagenes: [{ ubicacionArchivo: 'articulos/11/principal.jpg' }],
        formato: { nombreFormato: '300 ml', producto: { nombre: 'Shampoo' } },
        pack: null,
      },
    },
  ],
  envio: null,
  historial: [
    { estado: 'pendiente_pago', fechaHora: new Date('2026-10-20T15:00:00Z') },
    { estado: 'pagado', fechaHora: new Date('2026-10-20T15:05:00Z') },
  ],
  ...cambios,
});

describe('MisPedidosService', () => {
  let db: ReturnType<typeof crearDb>;
  let servicio: MisPedidosService;

  beforeEach(() => {
    db = crearDb();
    servicio = crearServicio(db);
  });

  describe('listar', () => {
    it('E8-H1 · historial: solo los pedidos de la cuenta, del más reciente al más antiguo, con fecha, total y estado', async () => {
      const fecha = new Date('2026-10-20T15:00:00Z');
      db.pedido.count.mockResolvedValue(2);
      db.pedido.findMany.mockResolvedValue([
        {
          codigoPublico: CODIGO,
          fechaPedido: fecha,
          estadoActual: 'pagado',
          montoTotal: 23800,
        },
      ]);

      const historial = await servicio.listar(CUENTA, {});

      expect(historial).toEqual({
        items: [
          {
            codigoPublico: CODIGO,
            fechaPedido: fecha,
            total: 23800,
            estado: 'pagado',
          },
        ],
        total: 2,
        pagina: 1,
        limite: 20,
      });
      const consulta = db.pedido.findMany.mock.calls[0][0];
      expect(consulta.where).toEqual({ usuario: { codigoPublico: CUENTA } });
      expect(consulta.orderBy).toEqual([
        { fechaPedido: 'desc' },
        { id: 'desc' },
      ]);
      expect(db.pedido.count.mock.calls[0][0].where).toEqual(consulta.where);
    });

    it('pagina con `pagina` y `limite`', async () => {
      await servicio.listar(CUENTA, { pagina: 3, limite: 5 });

      const consulta = db.pedido.findMany.mock.calls[0][0];
      expect(consulta.skip).toBe(10);
      expect(consulta.take).toBe(5);
    });

    it('sin pedidos responde vacío', async () => {
      expect(await servicio.listar(CUENTA, {})).toEqual({
        items: [],
        total: 0,
        pagina: 1,
        limite: 20,
      });
    });
  });

  describe('obtener', () => {
    it('E8-H1 · pedido de otra cuenta o inexistente: 404 sin datos, buscando solo en la cuenta del token', async () => {
      await expect(servicio.obtener(CUENTA, CODIGO)).rejects.toThrow(
        new NotFoundException('El pedido no existe.'),
      );
      expect(db.pedido.findFirst.mock.calls[0][0].where).toEqual({
        codigoPublico: CODIGO,
        usuario: { codigoPublico: CUENTA },
      });
    });

    it('E8-H1 · detalle: precio con IVA de lo cobrado, subtotales, montos guardados y cambios de estado en orden', async () => {
      db.pedido.findFirst.mockResolvedValue(filaPedido());

      const detalle = await servicio.obtener(CUENTA, CODIGO);

      const unitario = precioConIva(10000.4, IVA);
      expect(detalle).toMatchObject({
        codigoPublico: CODIGO,
        estado: 'pagado',
        tipoEntrega: 'retiro',
        tipoDocumento: 'boleta',
        porcentajeIva: 19,
        montos: { neto: 20000, iva: 3800, total: 23800 },
        envio: null,
        items: [
          {
            articuloId: 11,
            tipo: 'formato',
            nombre: 'Shampoo',
            nombreFormato: '300 ml',
            imagen: 'https://cdn.test/articulos/11/principal.jpg',
            cantidad: 2,
            precioUnitario: unitario,
            subtotal: unitario * 2,
          },
        ],
        historial: [
          { estado: 'pendiente_pago', fecha: expect.any(Date) },
          { estado: 'pagado', fecha: expect.any(Date) },
        ],
      });
      expect(
        db.pedido.findFirst.mock.calls[0][0].select.historial.orderBy,
      ).toEqual({ correlativo: 'asc' });
    });

    it('el comentario y el autor de un cambio de estado no se leen (son del personal)', async () => {
      db.pedido.findFirst.mockResolvedValue(filaPedido());

      await servicio.obtener(CUENTA, CODIGO);

      expect(
        db.pedido.findFirst.mock.calls[0][0].select.historial.select,
      ).toEqual({ estado: true, fechaHora: true });
    });

    it('un pack se nombra por el pack y sin imagen queda en null', async () => {
      db.pedido.findFirst.mockResolvedValue(
        filaPedido({
          detalles: [
            {
              articuloId: 30,
              cantidad: 1,
              precioUnitarioNetoAplicado: '15000',
              articulo: {
                tipo: 'pack',
                imagenes: [],
                formato: null,
                pack: { nombre: 'Dúo reparador' },
              },
            },
          ],
        }),
      );

      const { items } = await servicio.obtener(CUENTA, CODIGO);

      expect(items[0]).toMatchObject({
        tipo: 'pack',
        nombre: 'Dúo reparador',
        nombreFormato: null,
        imagen: null,
        precioUnitario: precioConIva(15000, IVA),
      });
    });

    it('despacho: costo del envío con IVA, fecha estimada AAAA-MM-DD y la dirección', async () => {
      db.pedido.findFirst.mockResolvedValue(
        filaPedido({
          tipoEntrega: 'despacho',
          envio: {
            servicioEnvio: 'Chilexpress',
            costoNeto: '3000',
            estadoEnvio: 'en_transito',
            codigoSeguimiento: 'SEG-123',
            fechaEstimada: new Date('2026-11-05T00:00:00Z'),
            destinatario: 'Marcela Soto',
            telefonoContacto: null,
            calle: 'Calle Falsa',
            numero: '123',
            referencia: null,
            comuna: { codigoCut: '13101', nombre: 'Santiago' },
          },
        }),
      );

      const { envio } = await servicio.obtener(CUENTA, CODIGO);

      expect(envio).toEqual({
        servicio: 'Chilexpress',
        costo: precioConIva(3000, IVA),
        estado: 'en_transito',
        codigoSeguimiento: 'SEG-123',
        fechaEstimada: '2026-11-05',
        destinatario: 'Marcela Soto',
        telefonoContacto: null,
        calle: 'Calle Falsa',
        numero: '123',
        referencia: null,
        comuna: { codigoCut: '13101', nombre: 'Santiago' },
      });
    });

    it('`pagarHasta` solo se informa mientras el pedido espera el pago; E6-H3 · es 2 minutos antes del plazo', async () => {
      db.pedido.findFirst.mockResolvedValue(
        filaPedido({ estadoActual: 'pendiente_pago' }),
      );
      expect((await servicio.obtener(CUENTA, CODIGO)).pagarHasta).toEqual(
        new Date('2026-10-20T15:13:00Z'),
      );

      db.pedido.findFirst.mockResolvedValue(filaPedido());
      expect((await servicio.obtener(CUENTA, CODIGO)).pagarHasta).toBeNull();
    });
  });
});
