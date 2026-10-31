import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { COLAS, type TrabajoPagoConfirmado } from '../src/colas/colas.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import {
  ESTADOS_PAGO,
  ESTADOS_PEDIDO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import {
  type CobroPedido,
  type PagoPasarela,
  PasarelaPago,
} from '../src/modulos/pagos/pasarela-pago.js';
import { PlazosProcessor } from '../src/modulos/pagos/plazos.processor.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
// Mercado Pago se reemplaza por un doble: los pagos que «existen» son los de `pagosMp`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/pedidos';
const NETO = 20000;
const IVA = 3800;
const TOTAL = NETO + IVA;
const URL_PAGO = 'https://www.mercadopago.cl/checkout/v1/redirect?pref_id=e2e';

/** Doble de Mercado Pago: guarda los cobros pedidos y responde los pagos registrados. */
class PasarelaDePrueba extends PasarelaPago {
  cobros: CobroPedido[] = [];
  pagosMp = new Map<string, PagoPasarela>();

  crearCobro(cobro: CobroPedido): Promise<string> {
    this.cobros.push(cobro);
    return Promise.resolve(URL_PAGO);
  }

  consultarPago(idExterno: string): Promise<PagoPasarela | null> {
    return Promise.resolve(this.pagosMp.get(idExterno) ?? null);
  }

  buscarPagosDePedido(): Promise<PagoPasarela[]> {
    return Promise.resolve([]);
  }
}

interface Confirmacion {
  estadoPago: string;
  pedido: { codigoPublico: string; estado: string; pagarHasta: string | null };
}

describe('Pagos · pagar el pedido en Mercado Pago (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  const pasarela = new PasarelaDePrueba();
  const correosCreados: string[] = [];

  const servidor = () => request(app.getHttpServer());

  const cuenta = async (rol: Rol) => {
    const email = `e2e-pagos-${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    const usuario = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Marcela',
        apellido: 'Soto',
        email,
        contrasenaHash: hashContrasena,
        rol,
        fechaVerificacionCorreo: new Date(),
      },
    });
    const respuesta = await servidor()
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return {
      usuarioId: usuario.id,
      token: (respuesta.body as { tokenAcceso: string }).tokenAcceso,
    };
  };

  /** Pedido de retiro con su primer cambio de estado; el plazo vence en `minutos`. */
  const nuevoPedido = async (
    usuarioId: number,
    {
      estado = ESTADOS_PEDIDO.PENDIENTE_PAGO as string,
      minutos = 15,
    }: { estado?: string; minutos?: number } = {},
  ) => {
    const pedido = await prisma.pedido.create({
      data: {
        codigoPublico: randomUUID()
          .replace(/-/g, '')
          .slice(0, 12)
          .toUpperCase(),
        usuarioId,
        fechaExpiracionPago: new Date(Date.now() + minutos * 60_000),
        estadoActual: estado,
        tipoEntrega: TIPOS_ENTREGA.RETIRO,
        tipoDocumentoSolicitado: TIPOS_DOCUMENTO.BOLETA,
        porcentajeIva: 19,
        montoNeto: NETO,
        montoIva: IVA,
        montoTotal: TOTAL,
        historial: { create: { correlativo: 1, estado } },
      },
    });
    return { id: pedido.id, codigo: pedido.codigoPublico };
  };

  /** Un pago que Mercado Pago «tiene» para ese pedido. */
  const pagoEnMp = (
    codigoPedido: string,
    datos: Partial<PagoPasarela> = {},
  ): string => {
    const idExterno = String(Date.now()) + String(pasarela.pagosMp.size);
    pasarela.pagosMp.set(idExterno, {
      idExterno,
      estado: ESTADOS_PAGO.APROBADO,
      monto: TOTAL,
      moneda: 'CLP',
      codigoPedido,
      medioPago: 'visa',
      fechaAprobacion: new Date(),
      ...datos,
    });
    return idExterno;
  };

  const confirmar = (token: string, codigo: string, pagoId: string) =>
    servidor()
      .post(`${RUTA}/${codigo}/pago/confirmar`)
      .auth(token, { type: 'bearer' })
      .send({ pagoId });

  const limpiar = async () => {
    const correos = app.get<Queue>(getQueueToken(COLAS.CORREOS));
    const trabajos: Job<TrabajoPagoConfirmado>[] = await correos.getJobs([
      'prioritized',
      'waiting',
      'delayed',
    ]);
    await Promise.all(
      trabajos
        .filter((t) => t.data?.destinatario?.startsWith('e2e-pagos-'))
        .map((t) => t.remove()),
    );
    const donde = { usuario: { email: { startsWith: 'e2e-pagos-' } } };
    await prisma.notificacion.deleteMany({ where: donde });
    await prisma.pago.deleteMany({ where: { pedido: donde } });
    await prisma.pedido.deleteMany({ where: donde });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PasarelaPago)
      .useValue(pasarela)
      // Sin el worker de plazos: estas pruebas crean pedidos vencidos que debe poder ver el pago
      .overrideProvider(PlazosProcessor)
      .useValue({})
      .compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiar();
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    pasarela.cobros = [];
    pasarela.pagosMp.clear();
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  it('E6-H1 · pedido pendiente: devuelve la URL de pago y cobra el total hasta el fin del plazo', async () => {
    const yo = await cuenta(ROLES.CLIENTE);
    const pedido = await nuevoPedido(yo.usuarioId);

    const respuesta = await servidor()
      .post(`${RUTA}/${pedido.codigo}/pago`)
      .auth(yo.token, { type: 'bearer' })
      .expect(200);

    expect(respuesta.body).toEqual({
      urlPago: URL_PAGO,
      pagarHasta: expect.any(String),
    });
    expect(pasarela.cobros).toEqual([
      expect.objectContaining({
        codigoPedido: pedido.codigo,
        montoTotal: TOTAL,
      }),
    ]);
  });

  it('E6-H1 · pago aprobado: registra el pago por el total, sin datos de la tarjeta, y deja el pedido pagado', async () => {
    const yo = await cuenta(ROLES.PROFESIONAL);
    const pedido = await nuevoPedido(yo.usuarioId);
    const pagoId = pagoEnMp(pedido.codigo);

    const respuesta = await confirmar(yo.token, pedido.codigo, pagoId).expect(
      200,
    );

    const cuerpo = respuesta.body as Confirmacion;
    expect(cuerpo.estadoPago).toBe('aprobado');
    expect(cuerpo.pedido).toMatchObject({
      codigoPublico: pedido.codigo,
      estado: 'pagado',
      pagarHasta: null,
    });
    const pagos = await prisma.pago.findMany({
      where: { pedidoId: pedido.id },
    });
    expect(pagos).toEqual([
      {
        id: expect.any(Number),
        pedidoId: pedido.id,
        idTransaccionExterna: pagoId,
        monto: TOTAL,
        estado: 'aprobado',
        fechaPago: expect.any(Date),
        medioPago: 'visa',
      },
    ]);
    const historial = await prisma.historialEstadoPedido.findMany({
      where: { pedidoId: pedido.id },
      orderBy: { correlativo: 'asc' },
    });
    expect(historial.map((cambio) => cambio.estado)).toEqual([
      'pendiente_pago',
      'pagado',
    ]);
    expect(historial[1].usuarioId).toBeNull();
  });

  it('E6-H1 · pago rechazado: el pedido sigue pendiente de pago y se puede reintentar dentro del plazo', async () => {
    const yo = await cuenta(ROLES.CLIENTE);
    const pedido = await nuevoPedido(yo.usuarioId);
    const rechazado = pagoEnMp(pedido.codigo, {
      estado: ESTADOS_PAGO.RECHAZADO,
      fechaAprobacion: null,
    });

    const respuesta = await confirmar(
      yo.token,
      pedido.codigo,
      rechazado,
    ).expect(200);

    const cuerpo = respuesta.body as Confirmacion;
    expect(cuerpo.estadoPago).toBe('rechazado');
    expect(cuerpo.pedido.estado).toBe('pendiente_pago');
    expect(cuerpo.pedido.pagarHasta).not.toBeNull();
    await servidor()
      .get(`${RUTA}/${pedido.codigo}`)
      .auth(yo.token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) =>
        expect((body as { estado: string }).estado).toBe('pendiente_pago'),
      );

    // Reintenta: otro cobro y esta vez se aprueba
    await servidor()
      .post(`${RUTA}/${pedido.codigo}/pago`)
      .auth(yo.token, { type: 'bearer' })
      .expect(200);
    const aprobado = pagoEnMp(pedido.codigo);
    await confirmar(yo.token, pedido.codigo, aprobado).expect(200);

    const pagos = await prisma.pago.findMany({
      where: { pedidoId: pedido.id },
      orderBy: { id: 'asc' },
    });
    expect(pagos.map((pago) => pago.estado)).toEqual(['rechazado', 'aprobado']);
  });

  it('E6-H1 · plazo vencido: ya no deja reintentar el pago (409)', async () => {
    const yo = await cuenta(ROLES.CLIENTE);
    const pedido = await nuevoPedido(yo.usuarioId, { minutos: -1 });

    await servidor()
      .post(`${RUTA}/${pedido.codigo}/pago`)
      .auth(yo.token, { type: 'bearer' })
      .expect(409);
    expect(pasarela.cobros).toEqual([]);
  });

  it('E6-H1 · pedido ya pagado: no prepara otro cobro ni acepta un segundo pago aprobado', async () => {
    const yo = await cuenta(ROLES.CLIENTE);
    const pedido = await nuevoPedido(yo.usuarioId);
    const primero = pagoEnMp(pedido.codigo);
    await confirmar(yo.token, pedido.codigo, primero).expect(200);

    await servidor()
      .post(`${RUTA}/${pedido.codigo}/pago`)
      .auth(yo.token, { type: 'bearer' })
      .expect(409)
      .expect(({ body }) =>
        expect((body as { message: string }).message).toBe(
          'El pedido ya está pagado.',
        ),
      );
    await confirmar(yo.token, pedido.codigo, pagoEnMp(pedido.codigo)).expect(
      409,
    );
    // Confirmar otra vez el mismo pago no repite nada
    await confirmar(yo.token, pedido.codigo, primero).expect(200);

    const aprobados = await prisma.pago.count({
      where: { pedidoId: pedido.id, estado: ESTADOS_PAGO.APROBADO },
    });
    expect(aprobados).toBe(1);
    expect(
      await prisma.historialEstadoPedido.count({
        where: { pedidoId: pedido.id },
      }),
    ).toBe(2);
  });

  it('E6-H1 · dos pagos aprobados que se confirman a la vez: solo uno queda aprobado (RNF-12)', async () => {
    const yo = await cuenta(ROLES.CLIENTE);
    const pedido = await nuevoPedido(yo.usuarioId);
    const ids = [pagoEnMp(pedido.codigo), pagoEnMp(pedido.codigo)];

    const respuestas = await Promise.all(
      ids.map((id) => confirmar(yo.token, pedido.codigo, id)),
    );

    expect(respuestas.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    expect(
      await prisma.pago.count({
        where: { pedidoId: pedido.id, estado: ESTADOS_PAGO.APROBADO },
      }),
    ).toBe(1);
  });

  it('pago de otro pedido, por otro monto o que no existe en Mercado Pago: 400 y el pedido no cambia', async () => {
    const yo = await cuenta(ROLES.CLIENTE);
    const pedido = await nuevoPedido(yo.usuarioId);
    const otro = await nuevoPedido(yo.usuarioId, {
      estado: ESTADOS_PEDIDO.CANCELADO,
    });

    await confirmar(yo.token, pedido.codigo, pagoEnMp(otro.codigo)).expect(400);
    await confirmar(
      yo.token,
      pedido.codigo,
      pagoEnMp(pedido.codigo, { monto: 100 }),
    ).expect(400);
    await confirmar(yo.token, pedido.codigo, '424242').expect(400);
    await confirmar(yo.token, pedido.codigo, 'abc').expect(400);

    const guardado = await prisma.pedido.findUniqueOrThrow({
      where: { id: pedido.id },
    });
    expect(guardado.estadoActual).toBe('pendiente_pago');
    expect(await prisma.pago.count({ where: { pedidoId: pedido.id } })).toBe(0);
  });

  it('RNF-07 · pedido de otra cuenta: 404, igual que uno que no existe', async () => {
    const yo = await cuenta(ROLES.CLIENTE);
    const otra = await cuenta(ROLES.CLIENTE);
    const pedido = await nuevoPedido(otra.usuarioId);

    await servidor()
      .post(`${RUTA}/${pedido.codigo}/pago`)
      .auth(yo.token, { type: 'bearer' })
      .expect(404);
    await confirmar(yo.token, pedido.codigo, pagoEnMp(pedido.codigo)).expect(
      404,
    );
    expect(pasarela.cobros).toEqual([]);
  });

  it('RNF-09 · límite por cuenta: la undécima solicitud del minuto responde 429 y no afecta a otra cuenta', async () => {
    const yo = await cuenta(ROLES.CLIENTE);
    const otra = await cuenta(ROLES.CLIENTE);
    const pedido = await nuevoPedido(yo.usuarioId);
    const delOtro = await nuevoPedido(otra.usuarioId);
    const irAPagar = (token: string, codigo: string) =>
      servidor().post(`${RUTA}/${codigo}/pago`).auth(token, { type: 'bearer' });

    for (let intento = 0; intento < 10; intento++) {
      await irAPagar(yo.token, pedido.codigo).expect(200);
    }
    await irAPagar(yo.token, pedido.codigo).expect(429);
    await irAPagar(otra.token, delOtro.codigo).expect(200);
  });

  it('RNF-03 · sin sesión: 401; personal de tienda: 403', async () => {
    const yo = await cuenta(ROLES.CLIENTE);
    const pedido = await nuevoPedido(yo.usuarioId);
    const vendedor = await cuenta(ROLES.VENDEDOR);

    await servidor().post(`${RUTA}/${pedido.codigo}/pago`).expect(401);
    await servidor()
      .post(`${RUTA}/${pedido.codigo}/pago/confirmar`)
      .send({ pagoId: '1' })
      .expect(401);
    await servidor()
      .post(`${RUTA}/${pedido.codigo}/pago`)
      .auth(vendedor.token, { type: 'bearer' })
      .expect(403);
    await confirmar(vendedor.token, pedido.codigo, '1').expect(403);
  });
});
