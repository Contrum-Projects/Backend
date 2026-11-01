import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ROLES } from '../../common/dominio/roles.js';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CarritoService } from '../carrito/carrito.service.js';
import type { CotizarEnvioService } from '../despacho/cotizar-envio.service.js';
import type { VentaStockService } from '../inventario/venta-stock.service.js';
import {
  CARRITO_CAMBIADO,
  CARRITO_VACIO,
  CORREO_SIN_CONFIRMAR,
  CrearPedidoService,
  FALTA_ELEGIR_DATOS_FACTURACION,
  PEDIDO_PENDIENTE,
  SIN_DATOS_FACTURACION,
} from './crear-pedido.service.js';
import type { CrearPedidoDto } from './dto/crear-pedido.dto.js';
import type { MisPedidosService } from './mis-pedidos.service.js';

const CUENTA = '3f0c2a52-0b9e-4c55-9d0e-6a3a4f6d1b2c';
const CLAVE = '0f8fad5b-d9cb-469f-a165-70867728950e';
const BULTO = { pesoGramos: 960, altoCm: 13, anchoCm: 13, largoCm: 13 };

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
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 7, fechaVerificacionCorreo: new Date() }),
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
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockResolvedValue({ id: 40, codigoPublico: 'AB12CD34EF56' }),
    },
    direccion: { findFirst: vi.fn() },
    datosFacturacion: { findMany: vi.fn().mockResolvedValue([]) },
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
  let envios: {
    bultoDelCarrito: ReturnType<typeof vi.fn>;
    cotizar: ReturnType<typeof vi.fn>;
  };
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
    envios = {
      bultoDelCarrito: vi.fn().mockResolvedValue(BULTO),
      cotizar: vi
        .fn()
        .mockResolvedValue({ servicio: 'EXPRESS', costoNeto: 6143 }),
    };
    const config = {
      get: vi.fn(
        (clave: string) =>
          ({
            IVA_PORCENTAJE: 19,
            PLAZO_PAGO_MINUTOS: 15,
            MINIMO_UNIDADES_PELUQUERO: 3,
          })[clave],
      ),
    };
    servicio = new CrearPedidoService(
      db as unknown as PrismaService,
      config as unknown as ConfigService<Entorno, true>,
      carrito as unknown as CarritoService,
      ventaStock as unknown as VentaStockService,
      misPedidos as unknown as MisPedidosService,
      envios as unknown as CotizarEnvioService,
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

  describe('despacho cotizado (E7-H2)', () => {
    const dtoDespacho = () =>
      dtoRetiro({ tipoEntrega: 'despacho', direccionId: 12 });

    beforeEach(() => {
      db.direccion.findFirst.mockResolvedValue({
        comunaId: 3,
        comuna: { codigoCut: '13101' },
        calle: 'Av. Prueba',
        numero: '123',
        referencia: null,
      });
    });

    it('E7-H2 · cotización obtenida: suma el costo al total y guarda el servicio y el neto en el envío', async () => {
      await servicio.crear(CUENTA, ROLES.CLIENTE, dtoDespacho());

      expect(envios.cotizar).toHaveBeenCalledWith('13101', BULTO);
      const datos = datosPedido();
      // 3 × 1.003 + 6.143 neto: 3 × 1.194 + 7.310 con IVA
      expect(datos).toMatchObject({
        montoNeto: 9152,
        montoIva: 1740,
        montoTotal: 10892,
      });
      expect(datos.envio.create).toEqual({
        comunaId: 3,
        servicioEnvio: 'EXPRESS',
        costoNeto: 6143,
        estadoEnvio: 'pendiente',
        destinatario: 'Marcela Soto',
        telefonoContacto: '+56911111111',
        calle: 'Av. Prueba',
        numero: '123',
        referencia: null,
      });
    });

    it('E7-H2 · cotización obtenida: consulta al courier antes de abrir la transacción', async () => {
      const orden: string[] = [];
      envios.cotizar.mockImplementation(() => {
        orden.push('cotizar');
        return Promise.resolve({ servicio: 'EXPRESS', costoNeto: 6143 });
      });
      db.$transaction.mockImplementation(
        (fn: (t: typeof db) => Promise<unknown>) => {
          orden.push('transaccion');
          return fn(db);
        },
      );

      await servicio.crear(CUENTA, ROLES.CLIENTE, dtoDespacho());

      expect(orden).toEqual(['cotizar', 'transaccion']);
    });

    it('E7-H2 · servicio de envíos sin respuesta: propaga el 503, sin crear el pedido ni vaciar el carrito', async () => {
      envios.cotizar.mockRejectedValue(
        new ServiceUnavailableException('No pudimos cotizar.'),
      );

      await expect(
        servicio.crear(CUENTA, ROLES.CLIENTE, dtoDespacho()),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(db.$transaction).not.toHaveBeenCalled();
      expect(db.pedido.create).not.toHaveBeenCalled();
      expect(db.itemCarrito.deleteMany).not.toHaveBeenCalled();
    });

    it('E7-H2 · comuna sin cobertura: propaga el 409 sin crear el pedido', async () => {
      envios.cotizar.mockRejectedValue(new ConflictException('Sin cobertura.'));

      await expect(
        servicio.crear(CUENTA, ROLES.CLIENTE, dtoDespacho()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(db.pedido.create).not.toHaveBeenCalled();
    });

    it('E7-H2 · carrito cambiado al cotizar: responde 409 sin crear el pedido', async () => {
      envios.bultoDelCarrito
        .mockResolvedValueOnce(BULTO)
        .mockResolvedValueOnce({ ...BULTO, pesoGramos: 640 });

      await expect(
        servicio.crear(CUENTA, ROLES.CLIENTE, dtoDespacho()),
      ).rejects.toThrow(CARRITO_CAMBIADO);
      expect(db.pedido.create).not.toHaveBeenCalled();
      expect(ventaStock.descontarPorPedido).not.toHaveBeenCalled();
    });

    it('E7-H2 · dirección cambiada al cotizar: responde 409 sin crear el pedido', async () => {
      db.direccion.findFirst
        .mockResolvedValueOnce({ comunaId: 3, comuna: { codigoCut: '13101' } })
        .mockResolvedValueOnce({
          comunaId: 4,
          calle: 'Otra',
          numero: '1',
          referencia: null,
        });

      await expect(
        servicio.crear(CUENTA, ROLES.CLIENTE, dtoDespacho()),
      ).rejects.toThrow(CARRITO_CAMBIADO);
      expect(db.pedido.create).not.toHaveBeenCalled();
    });

    it('E7-H2 · no gasta una consulta al courier con la clave repetida: devuelve el mismo pedido', async () => {
      db.pedido.findFirst.mockResolvedValueOnce({ id: 39 });
      db.pedido.findUnique.mockResolvedValue({ codigoPublico: 'YA1CREADO234' });

      await servicio.crear(CUENTA, ROLES.CLIENTE, dtoDespacho());

      expect(envios.cotizar).not.toHaveBeenCalled();
      expect(misPedidos.obtener).toHaveBeenCalledWith(CUENTA, 'YA1CREADO234');
    });

    it('E7-H2 · no gasta una consulta al courier con un pedido pendiente: responde 409', async () => {
      db.pedido.findFirst.mockResolvedValue({ id: 39 });

      await expect(
        servicio.crear(CUENTA, ROLES.CLIENTE, dtoDespacho()),
      ).rejects.toThrow(PEDIDO_PENDIENTE);
      expect(envios.cotizar).not.toHaveBeenCalled();
    });

    it('E7-H2 · no gasta una consulta al courier con una dirección ajena: responde 404', async () => {
      db.direccion.findFirst.mockResolvedValue(null);

      await expect(
        servicio.crear(CUENTA, ROLES.CLIENTE, dtoDespacho()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(envios.cotizar).not.toHaveBeenCalled();
    });

    it('E7-H2 · no gasta una consulta al courier con el carrito vacío: responde 409', async () => {
      envios.bultoDelCarrito.mockResolvedValue(null);
      db.carrito.findUnique.mockResolvedValue({ id: 5, items: [] });

      await expect(
        servicio.crear(CUENTA, ROLES.CLIENTE, dtoDespacho()),
      ).rejects.toThrow(CARRITO_VACIO);
      expect(envios.cotizar).not.toHaveBeenCalled();
    });

    it('E7-H2 · no gasta una consulta al courier con el correo sin confirmar: responde 403', async () => {
      db.usuario.findUnique.mockResolvedValue({
        id: 7,
        fechaVerificacionCorreo: null,
      });
      db.usuario.findUniqueOrThrow.mockResolvedValue({
        nombre: 'Marcela',
        apellido: 'Soto',
        telefono: null,
        fechaVerificacionCorreo: null,
      });

      await expect(
        servicio.crear(CUENTA, ROLES.CLIENTE, dtoDespacho()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(envios.cotizar).not.toHaveBeenCalled();
    });

    it('E7-H2 · con retiro nunca consulta al courier', async () => {
      await servicio.crear(CUENTA, ROLES.CLIENTE, dtoRetiro());

      expect(envios.cotizar).not.toHaveBeenCalled();
      expect(datosPedido().montoTotal).toBe(3582);
    });
  });

  it('E9-H1 · factura con datos guardados: asocia al pedido los que indicó, buscando solo los activos de la cuenta', async () => {
    db.datosFacturacion.findMany.mockResolvedValue([{ id: 2 }, { id: 3 }]);

    await servicio.crear(
      CUENTA,
      ROLES.CLIENTE,
      dtoRetiro({ tipoDocumento: 'factura', datosFacturacionId: 3 }),
    );

    expect(db.datosFacturacion.findMany.mock.calls[0][0].where).toEqual({
      usuarioId: 7,
      activo: true,
    });
    expect(datosPedido().datosFacturacionId).toBe(3);
    expect(datosPedido().tipoDocumentoSolicitado).toBe('factura');
  });

  it('E9-H1 · boleta: registra la elección sin datos de facturación y sin consultarlos', async () => {
    await servicio.crear(CUENTA, ROLES.CLIENTE, dtoRetiro());

    expect(datosPedido().tipoDocumentoSolicitado).toBe('boleta');
    expect(datosPedido().datosFacturacionId).toBeNull();
    expect(db.datosFacturacion.findMany).not.toHaveBeenCalled();
  });

  it('E9-H1 · factura sin datos: rechaza el pedido e indica registrarlos primero, aunque mande un id', async () => {
    for (const elegido of [{}, { datosFacturacionId: 3 }]) {
      const intento = servicio.crear(
        CUENTA,
        ROLES.CLIENTE,
        dtoRetiro({ tipoDocumento: 'factura', ...elegido }),
      );
      await expect(intento).rejects.toBeInstanceOf(ConflictException);
      await expect(intento).rejects.toThrow(SIN_DATOS_FACTURACION);
    }
    expect(db.pedido.create).not.toHaveBeenCalled();
    expect(ventaStock.descontarPorPedido).not.toHaveBeenCalled();
  });

  it('E9-H1 · factura con datos guardados sin indicar cuál: 400 que pide elegirlos', async () => {
    db.datosFacturacion.findMany.mockResolvedValue([{ id: 3 }]);

    const intento = servicio.crear(
      CUENTA,
      ROLES.CLIENTE,
      dtoRetiro({ tipoDocumento: 'factura' }),
    );

    await expect(intento).rejects.toBeInstanceOf(BadRequestException);
    await expect(intento).rejects.toThrow(FALTA_ELEGIR_DATOS_FACTURACION);
    expect(db.pedido.create).not.toHaveBeenCalled();
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

  it('E5-H3 · pedido pendiente: con uno sin pagar responde 409 sin crear otro ni tocar el stock', async () => {
    db.pedido.findFirst.mockResolvedValue({ id: 39 });

    const error = await servicio
      .crear(CUENTA, ROLES.CLIENTE, dtoRetiro())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(PEDIDO_PENDIENTE);
    expect(db.pedido.findFirst.mock.calls[0][0].where).toEqual({
      usuarioId: 7,
      estadoActual: 'pendiente_pago',
    });
    expect(db.pedido.create).not.toHaveBeenCalled();
    expect(ventaStock.descontarPorPedido).not.toHaveBeenCalled();
  });

  describe('mínimo del profesional (E5-H4)', () => {
    const lineaFormato = (
      articuloId: number,
      cantidad: number,
      producto: string,
    ) => ({
      articuloId,
      cantidad,
      articulo: {
        formato: { nombreFormato: '300 ml', producto: { nombre: producto } },
        pack: null,
      },
    });

    const lineaPack = (articuloId: number, cantidad: number) => ({
      articuloId,
      cantidad,
      articulo: { formato: null, pack: { nombre: 'Dúo reparador' } },
    });

    it('E5-H4 · mínimo cumplido: con 3 unidades de cada formato crea el pedido y guarda el mayorista en cada línea', async () => {
      db.carrito.findUnique.mockResolvedValue({
        id: 5,
        items: [lineaFormato(11, 3, 'Shampoo'), lineaFormato(12, 4, 'Bálsamo')],
      });
      carrito.articulosALaVenta.mockResolvedValue(
        new Map([
          [11, { tipo: 'formato', neto: 800 }],
          [12, { tipo: 'formato', neto: 900 }],
        ]),
      );

      await servicio.crear(CUENTA, ROLES.PROFESIONAL, dtoRetiro());

      expect(datosPedido().detalles.create).toEqual([
        {
          articuloId: 11,
          cantidad: 3,
          precioUnitarioNetoAplicado: 800,
          tipoPrecio: 'mayorista',
        },
        {
          articuloId: 12,
          cantidad: 4,
          precioUnitarioNetoAplicado: 900,
          tipoPrecio: 'mayorista',
        },
      ]);
    });

    it('E5-H4 · bajo el mínimo: responde 409, nombra solo los formatos que no alcanzan y no toca el stock ni el carrito', async () => {
      db.carrito.findUnique.mockResolvedValue({
        id: 5,
        items: [
          lineaFormato(11, 2, 'Shampoo'),
          lineaFormato(12, 3, 'Bálsamo'),
          lineaFormato(13, 1, 'Tónico'),
        ],
      });
      carrito.articulosALaVenta.mockResolvedValue(
        new Map([
          [11, { tipo: 'formato', neto: 800 }],
          [12, { tipo: 'formato', neto: 900 }],
          [13, { tipo: 'formato', neto: 700 }],
        ]),
      );

      const error = await servicio
        .crear(CUENTA, ROLES.PROFESIONAL, dtoRetiro())
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      const mensaje = (error as Error).message;
      expect(mensaje).toContain('Shampoo 300 ml');
      expect(mensaje).toContain('Tónico 300 ml');
      expect(mensaje).not.toContain('Bálsamo');
      expect(db.pedido.create).not.toHaveBeenCalled();
      expect(ventaStock.descontarPorPedido).not.toHaveBeenCalled();
      expect(db.itemCarrito.deleteMany).not.toHaveBeenCalled();
    });

    it('E5-H4 · un pack no necesita mínimo: una unidad se compra a mayorista', async () => {
      db.carrito.findUnique.mockResolvedValue({
        id: 5,
        items: [lineaPack(30, 1)],
      });
      carrito.articulosALaVenta.mockResolvedValue(
        new Map([[30, { tipo: 'pack', neto: 1500 }]]),
      );

      await servicio.crear(CUENTA, ROLES.PROFESIONAL, dtoRetiro());

      expect(datosPedido().detalles.create[0]).toMatchObject({
        articuloId: 30,
        cantidad: 1,
        tipoPrecio: 'mayorista',
      });
    });

    it('E5-H4 · el cliente no tiene mínimo: compra una unidad a precio minorista', async () => {
      db.carrito.findUnique.mockResolvedValue({
        id: 5,
        items: [lineaFormato(11, 1, 'Shampoo')],
      });

      await servicio.crear(CUENTA, ROLES.CLIENTE, dtoRetiro());

      expect(datosPedido().detalles.create[0]).toMatchObject({
        cantidad: 1,
        tipoPrecio: 'minorista',
      });
    });
  });

  it('la dirección o los datos de facturación de otra cuenta responden 404', async () => {
    db.direccion.findFirst.mockResolvedValue(null);
    db.datosFacturacion.findMany.mockResolvedValue([{ id: 8 }]);

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
