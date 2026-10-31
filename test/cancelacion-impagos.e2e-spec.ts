import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Job, Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { COLAS, type TrabajoPagoConfirmado } from '../src/colas/colas.js';
import { ROLES } from '../src/common/dominio/roles.js';
import {
  CANALES_VENTA,
  ESTADOS_EVENTO_PAGO,
  ESTADOS_PAGO,
  ESTADOS_PEDIDO,
  ORIGENES_DESCRIPCION,
  TIPOS_ARTICULO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
  TIPOS_MOVIMIENTO,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { VentaStockService } from '../src/modulos/inventario/venta-stock.service.js';
import { AplicarPagoService } from '../src/modulos/pagos/aplicar-pago.service.js';
import { NotificacionPagoService } from '../src/modulos/pagos/notificacion-pago.service.js';
import {
  type PagoPasarela,
  PasarelaPago,
} from '../src/modulos/pagos/pasarela-pago.js';
import { PlazosProcessor } from '../src/modulos/pagos/plazos.processor.js';
import { VencimientoPagoService } from '../src/modulos/pagos/vencimiento-pago.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
// Mercado Pago se reemplaza por un doble. La pasada se llama a mano, sin el worker de plazos.

const PREFIJO = 'E2E-impagos';
const PREFIJO_CORREO = 'e2e-impagos-';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '92';
const COMUNA = '92001';
const TOTAL = 23800;

class PasarelaDePrueba extends PasarelaPago {
  pagosMp: PagoPasarela[] = [];
  caida = false;

  crearCobro(): Promise<string> {
    return Promise.resolve('https://www.mercadopago.cl/e2e');
  }

  consultarPago(idExterno: string): Promise<PagoPasarela | null> {
    return Promise.resolve(
      this.pagosMp.find((pago) => pago.idExterno === idExterno) ?? null,
    );
  }

  buscarPagosDePedido(codigoPedido: string): Promise<PagoPasarela[]> {
    if (this.caida) {
      return Promise.reject(new ServiceUnavailableException('sin respuesta'));
    }
    return Promise.resolve(
      this.pagosMp.filter((pago) => pago.codigoPedido === codigoPedido),
    );
  }
}

describe('Pagos · cancelación de pedidos impagos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ventaStock: VentaStockService;
  let vencimientos: VencimientoPagoService;
  let notificaciones: NotificacionPagoService;
  let correos: Queue;
  let compradorId: number;
  let comunaId: number;
  let ubicacionId: number;
  let formatoId: number;
  let secuencia = 0;
  const pasarela = new PasarelaDePrueba();
  const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
  const eventosCreados: string[] = [];

  const unico = () => randomUUID().slice(0, 8);

  /** Pedido de 5 unidades con su stock descontado; el plazo vence en `minutos`. */
  const nuevoPedido = async (minutos: number) => {
    const codigoPublico = randomUUID()
      .replaceAll('-', '')
      .slice(0, 12)
      .toUpperCase();
    const pedido = await prisma.$transaction(async (tx) => {
      const creado = await tx.pedido.create({
        data: {
          codigoPublico,
          usuarioId: compradorId,
          fechaExpiracionPago: new Date(Date.now() + minutos * 60_000),
          estadoActual: ESTADOS_PEDIDO.PENDIENTE_PAGO,
          tipoEntrega: TIPOS_ENTREGA.RETIRO,
          tipoDocumentoSolicitado: TIPOS_DOCUMENTO.BOLETA,
          porcentajeIva: 19,
          montoNeto: 20000,
          montoIva: 3800,
          montoTotal: TOTAL,
          historial: {
            create: { correlativo: 1, estado: ESTADOS_PEDIDO.PENDIENTE_PAGO },
          },
        },
      });
      await ventaStock.descontarPorPedido(tx, creado.id, [
        { articuloId: formatoId, cantidad: 5 },
      ]);
      return creado;
    });
    return { id: pedido.id, codigo: codigoPublico };
  };

  const pagoEnMp = (
    codigoPedido: string,
    datos: Partial<PagoPasarela> = {},
  ): PagoPasarela => {
    secuencia += 1;
    const pago: PagoPasarela = {
      idExterno: `${Date.now()}${secuencia}`,
      estado: ESTADOS_PAGO.APROBADO,
      monto: TOTAL,
      moneda: 'CLP',
      codigoPedido,
      medioPago: 'visa',
      fechaAprobacion: new Date(),
      ...datos,
    };
    pasarela.pagosMp.push(pago);
    return pago;
  };

  const nuevoEvento = (idPago: string, intentos: number) => {
    const idEventoExterno = randomUUID();
    eventosCreados.push(idEventoExterno);
    return prisma.eventoPago.create({
      data: {
        idEventoExterno,
        tipoEvento: 'payment',
        estadoProcesamiento: ESTADOS_EVENTO_PAGO.PENDIENTE,
        intentos,
        contenidoRecibido: JSON.stringify({ idPago }),
      },
    });
  };

  const estadoDe = async (id: number) =>
    (await prisma.pedido.findUniqueOrThrow({ where: { id } })).estadoActual;

  const estadoDelEvento = async (id: number) =>
    (await prisma.eventoPago.findUniqueOrThrow({ where: { id } }))
      .estadoProcesamiento;

  const stock = async () =>
    (
      await prisma.existencia.findUniqueOrThrow({
        where: { formatoId_ubicacionId: { formatoId, ubicacionId } },
      })
    ).cantidad;

  const limpiarPedidos = async () => {
    const trabajos: Job<TrabajoPagoConfirmado>[] = await correos.getJobs([
      'prioritized',
      'waiting',
      'delayed',
    ]);
    await Promise.all(
      trabajos
        .filter((t) => t.data?.destinatario?.startsWith(PREFIJO_CORREO))
        .map((t) => t.remove()),
    );
    const donde = { usuario: { email: { startsWith: PREFIJO_CORREO } } };
    await prisma.eventoPago.deleteMany({
      where: { idEventoExterno: { in: eventosCreados } },
    });
    await prisma.notificacion.deleteMany({ where: donde });
    await prisma.pago.deleteMany({ where: { pedido: donde } });
    await prisma.movimientoInventario.deleteMany({
      where: { pedido: donde },
    });
    await prisma.pedido.deleteMany({ where: donde });
  };

  const limpiar = async () => {
    await limpiarPedidos();
    const formatosPrueba = {
      formato: { articulo: { sku: { startsWith: PREFIJO } } },
    };
    await prisma.movimientoInventario.deleteMany({ where: formatosPrueba });
    await prisma.existencia.deleteMany({ where: formatosPrueba });
    await prisma.articuloVenta.deleteMany({
      where: { sku: { startsWith: PREFIJO } },
    });
    await prisma.producto.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.categoria.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.ubicacion.deleteMany({
      where: { bodega: { nombre: { startsWith: PREFIJO } } },
    });
    await prisma.bodega.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PasarelaPago)
      .useValue(pasarela)
      .overrideProvider(PlazosProcessor)
      .useValue({})
      .compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    ventaStock = app.get(VentaStockService);
    vencimientos = app.get(VencimientoPagoService);
    notificaciones = app.get(NotificacionPagoService);
    correos = app.get(getQueueToken(COLAS.CORREOS));
    await limpiar();

    const region = await prisma.region.upsert({
      where: { codigoCut: REGION },
      update: {},
      create: { codigoCut: REGION, nombre: 'Región de prueba impagos' },
    });
    comunaId = (
      await prisma.comuna.upsert({
        where: { codigoCut: COMUNA },
        update: {},
        create: {
          codigoCut: COMUNA,
          nombre: 'Comuna de prueba impagos',
          regionId: region.id,
        },
      })
    ).id;
    compradorId = (
      await prisma.usuario.create({
        data: {
          codigoPublico: randomUUID(),
          nombre: 'Marcela',
          apellido: 'Soto',
          email,
          contrasenaHash: 'sin-uso',
          rol: ROLES.CLIENTE,
          fechaVerificacionCorreo: new Date(),
        },
      })
    ).id;
    const bodega = await prisma.bodega.create({
      data: {
        nombre: `${PREFIJO} Tienda`,
        direccion: 'Calle de prueba 400',
        tipo: 'tienda',
        comunaId,
      },
    });
    ubicacionId = (
      await prisma.ubicacion.create({
        data: { bodegaId: bodega.id, codigo: 'A-01' },
      })
    ).id;
    const categoria = await prisma.categoria.create({
      data: { nombre: `${PREFIJO} Cat ${unico()}` },
    });
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo ${unico()}`,
        descripcion: 'Repara el cabello.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta: CANALES_VENTA.GENERAL,
        categoriaId: categoria.id,
      },
    });
    const articulo = await prisma.articuloVenta.create({
      data: { sku: `${PREFIJO}-${unico()}`, tipo: TIPOS_ARTICULO.FORMATO },
    });
    formatoId = articulo.id;
    await prisma.formatoProducto.create({
      data: {
        id: formatoId,
        productoId: producto.id,
        nombreFormato: '300 ml',
        pesoGramos: 320,
        altoCm: 18,
        anchoCm: 6,
        largoCm: 6,
        esPredeterminado: true,
      },
    });
    await prisma.existencia.create({
      data: { formatoId, ubicacionId, cantidad: 100 },
    });
  });

  beforeEach(() => {
    pasarela.pagosMp = [];
    pasarela.caida = false;
  });

  afterEach(async () => {
    await limpiarPedidos();
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({ where: { email } });
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E6-H3 · plazo vencido sin pago: cancela el pedido y libera su reserva de stock', async () => {
    const pedido = await nuevoPedido(-1);
    const antes = await stock();

    await vencimientos.cancelarVencidos();

    expect(await estadoDe(pedido.id)).toBe('cancelado');
    expect(await stock()).toBe(antes + 5);
    const reingresos = await prisma.movimientoInventario.findMany({
      where: { pedidoId: pedido.id, tipo: TIPOS_MOVIMIENTO.REINGRESO },
    });
    expect(reingresos).toHaveLength(1);
    expect(reingresos[0]).toMatchObject({
      cantidad: 5,
      usuarioId: null,
      ubicacionDestinoId: ubicacionId,
    });
    const historial = await prisma.historialEstadoPedido.findMany({
      where: { pedidoId: pedido.id },
      orderBy: { correlativo: 'asc' },
    });
    expect(historial.at(-1)).toMatchObject({
      correlativo: 2,
      estado: 'cancelado',
      usuarioId: null,
      comentario: 'Plazo de pago vencido.',
    });
  });

  it('E6-H3 · plazo aún sin vencer: el pedido sigue pendiente con su reserva', async () => {
    const pedido = await nuevoPedido(15);
    const antes = await stock();

    await vencimientos.cancelarVencidos();

    expect(await estadoDe(pedido.id)).toBe('pendiente_pago');
    expect(await stock()).toBe(antes);
  });

  it('E6-H3 · pago dentro del plazo: al cumplirse el plazo el pedido sigue pagado y conserva su reserva', async () => {
    const pedido = await nuevoPedido(-1);
    await prisma.pedido.update({
      where: { id: pedido.id },
      data: { estadoActual: ESTADOS_PEDIDO.PAGADO },
    });
    const antes = await stock();

    await vencimientos.cancelarVencidos();

    expect(await estadoDe(pedido.id)).toBe('pagado');
    expect(await stock()).toBe(antes);
  });

  it('RNF-29 · pago aprobado sin notificar al vencer el plazo: lo aplica y no cancela', async () => {
    const pedido = await nuevoPedido(-1);
    const pago = pagoEnMp(pedido.codigo);
    const antes = await stock();

    await vencimientos.cancelarVencidos();

    expect(await estadoDe(pedido.id)).toBe('pagado');
    expect(await stock()).toBe(antes);
    expect(
      await prisma.pago.findUniqueOrThrow({
        where: { idTransaccionExterna: pago.idExterno },
      }),
    ).toMatchObject({ pedidoId: pedido.id, estado: 'aprobado' });
    expect(
      await prisma.notificacion.count({
        where: { pedidoId: pedido.id, tipo: 'pago_confirmado' },
      }),
    ).toBe(1);
  });

  it('E6-H3 · intento rechazado en Mercado Pago: cancela igual', async () => {
    const pedido = await nuevoPedido(-1);
    pagoEnMp(pedido.codigo, { estado: ESTADOS_PAGO.RECHAZADO });

    await vencimientos.cancelarVencidos();

    expect(await estadoDe(pedido.id)).toBe('cancelado');
  });

  it('E6-H3 · Mercado Pago no responde: no cancela y lo hace cuando vuelve a responder', async () => {
    const pedido = await nuevoPedido(-1);
    const antes = await stock();
    pasarela.caida = true;

    await vencimientos.cancelarVencidos();

    expect(await estadoDe(pedido.id)).toBe('pendiente_pago');
    expect(await stock()).toBe(antes);

    pasarela.caida = false;
    await vencimientos.cancelarVencidos();

    expect(await estadoDe(pedido.id)).toBe('cancelado');
    expect(await stock()).toBe(antes + 5);
  });

  it('RNF-12 · dos pasadas simultáneas: el pedido se cancela una vez y el stock vuelve una vez', async () => {
    const pedido = await nuevoPedido(-1);
    const antes = await stock();

    await Promise.all([
      vencimientos.cancelarVencidos(),
      vencimientos.cancelarVencidos(),
    ]);

    expect(await estadoDe(pedido.id)).toBe('cancelado');
    expect(await stock()).toBe(antes + 5);
    expect(
      await prisma.historialEstadoPedido.count({
        where: { pedidoId: pedido.id, estado: 'cancelado' },
      }),
    ).toBe(1);
  });

  it('RNF-12 · pago y cancelación simultáneos: gana uno y el stock queda coherente con el resultado', async () => {
    const pedido = await nuevoPedido(-1);
    const antes = await stock();
    const pago: PagoPasarela = {
      idExterno: `${Date.now()}-simultaneo`,
      estado: ESTADOS_PAGO.APROBADO,
      monto: TOTAL,
      moneda: 'CLP',
      codigoPedido: pedido.codigo,
      medioPago: 'visa',
      fechaAprobacion: new Date(),
    };

    // Sin pago visible en la búsqueda: la pasada cancela mientras llega el aviso del pago
    const [resultadoPago] = await Promise.allSettled([
      app.get(AplicarPagoService).aplicar(pago),
      vencimientos.cancelarVencidos(),
    ]);

    const estado = await estadoDe(pedido.id);
    const aprobados = await prisma.pago.count({
      where: { pedidoId: pedido.id, estado: ESTADOS_PAGO.APROBADO },
    });
    if (resultadoPago.status === 'fulfilled') {
      expect(estado).toBe('pagado');
      expect(aprobados).toBe(1);
      expect(await stock()).toBe(antes);
    } else {
      expect(estado).toBe('cancelado');
      expect(aprobados).toBe(0);
      expect(await stock()).toBe(antes + 5);
    }
  });

  it('E6-H3 · notificación con error: al agotar los reintentos queda marcada para revisión', async () => {
    const evento = await nuevoEvento('999000111', 4);

    // El último intento falla porque Mercado Pago aún no conoce el pago
    await expect(notificaciones.procesar(evento.id)).rejects.toThrow();
    expect(await estadoDelEvento(evento.id)).toBe('pendiente');

    await notificaciones.revisarPendientes();

    expect(await estadoDelEvento(evento.id)).toBe('revision_manual');
    expect(
      (await prisma.eventoPago.findUniqueOrThrow({ where: { id: evento.id } }))
        .intentos,
    ).toBe(5);
  });

  it('E6-H3 · notificación con error: si el último intento termina bien después de marcarla, queda procesada', async () => {
    const pedido = await nuevoPedido(15);
    const pago = pagoEnMp(pedido.codigo);
    const evento = await nuevoEvento(pago.idExterno, 4);
    const consulta = vi
      .spyOn(pasarela, 'consultarPago')
      .mockImplementationOnce(async () => {
        // Mientras corre el último intento, la revisión periódica ve que agotó los reintentos
        await notificaciones.revisarPendientes();
        expect(await estadoDelEvento(evento.id)).toBe('revision_manual');
        return pago;
      });

    await notificaciones.procesar(evento.id);
    consulta.mockRestore();

    expect(await estadoDelEvento(evento.id)).toBe('procesado');
    expect(await estadoDe(pedido.id)).toBe('pagado');
  });

  it('E6-H3 · notificación que aún tiene reintentos: sigue pendiente', async () => {
    const evento = await nuevoEvento('999000222', 2);

    await notificaciones.revisarPendientes();

    expect(await estadoDelEvento(evento.id)).toBe('pendiente');
  });

  it('E6-H3 · pago aprobado de un pedido cancelado: la notificación queda para revisión y el pedido no cambia', async () => {
    const pedido = await nuevoPedido(-1);
    await vencimientos.cancelarVencidos();
    const pago = pagoEnMp(pedido.codigo);
    const evento = await nuevoEvento(pago.idExterno, 0);

    await notificaciones.procesar(evento.id);

    expect(await estadoDelEvento(evento.id)).toBe('revision_manual');
    expect(await estadoDe(pedido.id)).toBe('cancelado');
  });

  it('E6-H3 · pago de un pedido que no existe: la notificación queda descartada', async () => {
    const pago = pagoEnMp('NOEXISTE0000');
    const evento = await nuevoEvento(pago.idExterno, 0);

    await notificaciones.procesar(evento.id);

    expect(await estadoDelEvento(evento.id)).toBe('descartado');
  });
});
