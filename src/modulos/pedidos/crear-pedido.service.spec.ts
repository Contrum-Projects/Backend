import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ROLES } from '../../common/dominio/roles.js';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CarritoService } from '../carrito/carrito.service.js';
import type { VentaStockService } from '../inventario/venta-stock.service.js';
import {
  CARRITO_VACIO,
  CORREO_SIN_CONFIRMAR,
  CrearPedidoService,
} from './crear-pedido.service.js';
import type { CrearPedidoDto } from './dto/crear-pedido.dto.js';
import type { MisPedidosService } from './mis-pedidos.service.js';

const CUENTA = '3f0c2a52-0b9e-4c55-9d0e-6a3a4f6d1b2c';
const CLAVE = '0f8fad5b-d9cb-469f-a165-70867728950e';

const dtoRetiro = (extra: Partial<CrearPedidoDto> = {}): CrearPedidoDto => ({
  claveIdempotencia: CLAVE,
  tipoEntrega: 'retiro',
  tipoDocumento: 'boleta',
  ...extra,
});

const crearDb = () => {
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 7 }]),
    usuario: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        nombre: 'Marcela',
        apellido: 'Soto',
        telefono: '+56911111111',
        fechaVerificacionCorreo: new Date(),
      }),
    },
    carrito: {
      findUnique: vi.fn().mockResolvedValue({
        id: 5,
        items: [
          {
            articuloId: 11,
            cantidad: 3,
            articulo: {
              formato: {
                nombreFormato: '300 ml',
                producto: { nombre: 'Shampoo' },
              },
              pack: null,
            },
          },
        ],
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    itemCarrito: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    pedido: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockResolvedValue({ id: 40, codigoPublico: 'AB12CD34EF56' }),
    },
    direccion: { findFirst: vi.fn() },
    datosFacturacion: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((fn: (t: typeof db) => Promise<unknown>) =>
    fn(db),
  );
  return db;
};

describe('CrearPedidoService', () => {
  let db: ReturnType<typeof crearDb>;
  let carrito: { articulosALaVenta: ReturnType<typeof vi.fn> };
  let ventaStock: {
    descontarPorPedido: ReturnType<typeof vi.fn>;
    encolarAvisos: ReturnType<typeof vi.fn>;
  };
  let misPedidos: { obtener: ReturnType<typeof vi.fn> };
  let servicio: CrearPedidoService;

  beforeEach(() => {
    db = crearDb();
    carrito = {
      articulosALaVenta: vi
        .fn()
        .mockResolvedValue(new Map([[11, { tipo: 'formato', neto: 1003 }]])),
    };
    ventaStock = {
      descontarPorPedido: vi.fn().mockResolvedValue({
        descuentos: [],
        avisos: [{ notificacionId: 9 }],
      }),
      encolarAvisos: vi.fn().mockResolvedValue(undefined),
    };
    misPedidos = {
      obtener: vi.fn().mockResolvedValue({ codigoPublico: 'AB12CD34EF56' }),
    };
    const config = {
      get: vi.fn(
        (clave: string) =>
          ({ IVA_PORCENTAJE: 19, PLAZO_PAGO_MINUTOS: 15 })[clave],
      ),
    };
    servicio = new CrearPedidoService(
      db as unknown as PrismaService,
      config as unknown as ConfigService<Entorno, true>,
      carrito as unknown as CarritoService,
      ventaStock as unknown as VentaStockService,
      misPedidos as unknown as MisPedidosService,
    );
  });

  const datosPedido = () => db.pedido.create.mock.calls[0][0].data;

  it('E5-H3 · pedido creado: recalcula montos igual que el carrito, reserva el stock, vacía el carrito y da 15 minutos', async () => {
    const antes = Date.now();
    const respuesta = await servicio.crear(CUENTA, ROLES.CLIENTE, dtoRetiro());

    expect(respuesta).toEqual({ codigoPublico: 'AB12CD34EF56' });
    const datos = datosPedido();
    // 3 × 1.003 neto: 3 × 1.194 con IVA, como muestra el carrito
    expect(datos).toMatchObject({
      usuarioId: 7,
      claveIdempotencia: CLAVE,
      estadoActual: 'pendiente_pago',
      tipoEntrega: 'retiro',
      tipoDocumentoSolicitado: 'boleta',
      porcentajeIva: 19,
      montoNeto: 3009,
      montoIva: 573,
      montoTotal: 3582,
      datosFacturacionId: null,
      envio: undefined,
    });
    expect(datos.codigoPublico).toMatch(/^[A-Z2-9]{12}$/);
    expect(datos.detalles.create).toEqual([
      {
        articuloId: 11,
        cantidad: 3,
        precioUnitarioNetoAplicado: 1003,
        tipoPrecio: 'minorista',
      },
    ]);
    expect(datos.historial.create).toEqual({
      correlativo: 1,
      usuarioId: 7,
      estado: 'pendiente_pago',
    });
    const plazo = datos.fechaExpiracionPago.getTime() - antes;
    expect(plazo).toBeGreaterThanOrEqual(15 * 60_000);
    expect(plazo).toBeLessThan(15 * 60_000 + 5_000);

    expect(ventaStock.descontarPorPedido).toHaveBeenCalledWith(db, 40, [
      { articuloId: 11, cantidad: 3 },
    ]);
    expect(db.itemCarrito.deleteMany).toHaveBeenCalledWith({
      where: { carritoId: 5 },
    });
  });

  it('E5-H3 · pedido creado: encola los avisos de stock bajo después del commit', async () => {
    const orden: string[] = [];
    db.$transaction.mockImplementation(
      async (fn: (t: typeof db) => Promise<unknown>) => {
        const resultado = await fn(db);
        orden.push('commit');
        return resultado;
      },
    );
    ventaStock.encolarAvisos.mockImplementation(() => {
      orden.push('encolar');
      return Promise.resolve();
    });

    await servicio.crear(CUENTA, ROLES.CLIENTE, dtoRetiro());

    expect(orden).toEqual(['commit', 'encolar']);
    expect(ventaStock.encolarAvisos).toHaveBeenCalledWith([
      { notificacionId: 9 },
    ]);
  });

  it('E5-H3 · pedido creado: el profesional guarda la línea como mayorista con el precio de su rol', async () => {
    await servicio.crear(CUENTA, ROLES.PROFESIONAL, dtoRetiro());

    expect(carrito.articulosALaVenta).toHaveBeenCalledWith(
      db,
      [11],
      ROLES.PROFESIONAL,
    );
    expect(datosPedido().detalles.create[0].tipoPrecio).toBe('mayorista');
  });

  it('E5-H3 · pedido creado: el despacho copia la dirección y queda con costo 0 y valores provisionales', async () => {
    db.direccion.findFirst.mockResolvedValue({
      comunaId: 3,
      calle: 'Av. Prueba',
      numero: '123',
      referencia: null,
    });

    await servicio.crear(
      CUENTA,
      ROLES.CLIENTE,
      dtoRetiro({ tipoEntrega: 'despacho', direccionId: 12 }),
    );

    expect(db.direccion.findFirst.mock.calls[0][0].where).toEqual({
      id: 12,
      usuarioId: 7,
    });
    const datos = datosPedido();
    expect(datos.montoTotal).toBe(3582);
    expect(datos.envio.create).toEqual({
      comunaId: 3,
      servicioEnvio: 'por_cotizar',
      costoNeto: 0,
      estadoEnvio: 'pendiente',
      destinatario: 'Marcela Soto',
      telefonoContacto: '+56911111111',
      calle: 'Av. Prueba',
      numero: '123',
      referencia: null,
    });
  });

  it('E5-H3 · pedido creado: la factura usa los datos activos de la cuenta', async () => {
    db.datosFacturacion.findFirst.mockResolvedValue({ id: 3 });

    await servicio.crear(
      CUENTA,
      ROLES.CLIENTE,
      dtoRetiro({ tipoDocumento: 'factura', datosFacturacionId: 3 }),
    );

    expect(db.datosFacturacion.findFirst.mock.calls[0][0].where).toEqual({
      id: 3,
      usuarioId: 7,
      activo: true,
    });
    expect(datosPedido().datosFacturacionId).toBe(3);
  });

  it('E5-H3 · stock insuficiente: propaga el 409 que nombra el artículo y no vacía el carrito', async () => {
    ventaStock.descontarPorPedido.mockRejectedValue(
      new ConflictException('No hay stock suficiente de Shampoo 300 ml.'),
    );

    await expect(
      servicio.crear(CUENTA, ROLES.CLIENTE, dtoRetiro()),
    ).rejects.toThrow('No hay stock suficiente de Shampoo 300 ml.');
    expect(db.itemCarrito.deleteMany).not.toHaveBeenCalled();
    expect(ventaStock.encolarAvisos).not.toHaveBeenCalled();
  });

  it('E5-H3 · stock insuficiente: un artículo que ya no se vende responde 409 con su nombre', async () => {
    carrito.articulosALaVenta.mockResolvedValue(new Map());

    const error = await servicio
      .crear(CUENTA, ROLES.CLIENTE, dtoRetiro())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toContain('Shampoo 300 ml');
    expect(db.pedido.create).not.toHaveBeenCalled();
  });

  it('E5-H3 · correo sin confirmar: responde 403 e indica que debe confirmarlo', async () => {
    db.usuario.findUniqueOrThrow.mockResolvedValue({
      nombre: 'Marcela',
      apellido: 'Soto',
      telefono: null,
      fechaVerificacionCorreo: null,
    });

    const error = await servicio
      .crear(CUENTA, ROLES.CLIENTE, dtoRetiro())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as Error).message).toBe(CORREO_SIN_CONFIRMAR);
    expect(db.pedido.create).not.toHaveBeenCalled();
  });

  it('E5-H3 · doble confirmación: la misma clave devuelve el pedido ya creado sin crear otro', async () => {
    db.pedido.findUnique.mockResolvedValue({ codigoPublico: 'YA1CREADO234' });

    await servicio.crear(CUENTA, ROLES.CLIENTE, dtoRetiro());

    expect(db.pedido.create).not.toHaveBeenCalled();
    expect(ventaStock.descontarPorPedido).not.toHaveBeenCalled();
    expect(misPedidos.obtener).toHaveBeenCalledWith(CUENTA, 'YA1CREADO234');
  });

  it('E5-H3 · doble confirmación: con otra clave el carrito ya vacío responde 409', async () => {
    db.carrito.findUnique.mockResolvedValue({ id: 5, items: [] });

    const error = await servicio
      .crear(CUENTA, ROLES.CLIENTE, dtoRetiro())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(CARRITO_VACIO);
    expect(db.pedido.create).not.toHaveBeenCalled();
  });

  it('la dirección o los datos de facturación de otra cuenta responden 404', async () => {
    db.direccion.findFirst.mockResolvedValue(null);
    db.datosFacturacion.findFirst.mockResolvedValue(null);

    await expect(
      servicio.crear(
        CUENTA,
        ROLES.CLIENTE,
        dtoRetiro({ tipoEntrega: 'despacho', direccionId: 12 }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      servicio.crear(
        CUENTA,
        ROLES.CLIENTE,
        dtoRetiro({ tipoDocumento: 'factura', datosFacturacionId: 3 }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.pedido.create).not.toHaveBeenCalled();
  });

  it('un total que no cabe en la columna responde 400', async () => {
    carrito.articulosALaVenta.mockResolvedValue(
      new Map([[11, { tipo: 'formato', neto: 9_000_000_000 }]]),
    );

    await expect(
      servicio.crear(CUENTA, ROLES.CLIENTE, dtoRetiro()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
