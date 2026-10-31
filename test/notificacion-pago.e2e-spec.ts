import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Job, Queue } from 'bullmq';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoPagoConfirmado,
} from '../src/colas/colas.js';
import { ROLES } from '../src/common/dominio/roles.js';
import {
  ESTADOS_PAGO,
  ESTADOS_PEDIDO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import {
  type PagoPasarela,
  PasarelaPago,
} from '../src/modulos/pagos/pasarela-pago.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
// Mercado Pago se reemplaza por un doble: los pagos que «existen» son los de `pagosMp`.

const CONTRASENA = 'Secreta123';
// Antes de los imports: ConfigModule lee el entorno al importar AppModule
const SECRETO = vi.hoisted(() => {
  const secreto = 'secreto-e2e-notificaciones';
  process.env.MERCADOPAGO_WEBHOOK_SECRET = secreto;
  return secreto;
});
const RUTA = '/api/pagos/notificaciones';
const PREFIJO_CORREO = 'e2e-notificacion-pago-';
const TOTAL = 23800;

class PasarelaDePrueba extends PasarelaPago {
  pagosMp = new Map<string, PagoPasarela>();

  crearCobro(): Promise<string> {
    return Promise.resolve('https://www.mercadopago.cl/e2e');
  }

  consultarPago(idExterno: string): Promise<PagoPasarela | null> {
    return Promise.resolve(this.pagosMp.get(idExterno) ?? null);
  }

  buscarPagosDePedido(): Promise<PagoPasarela[]> {
    return Promise.resolve([]);
  }
}

describe('Pagos · notificaciones de Mercado Pago (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let correos: Queue;
  let usuarioId: number;
  let secuencia = 0;
  const pasarela = new PasarelaDePrueba();
  const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
  const eventosCreados: string[] = [];

  const nuevoPedido = async () => {
    const pedido = await prisma.pedido.create({
      data: {
        codigoPublico: randomUUID()
          .replace(/-/g, '')
          .slice(0, 12)
          .toUpperCase(),
        usuarioId,
        fechaExpiracionPago: new Date(Date.now() + 15 * 60_000),
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
    return { id: pedido.id, codigo: pedido.codigoPublico };
  };

  const pagoEnMp = (
    codigoPedido: string,
    datos: Partial<PagoPasarela> = {},
  ): string => {
    secuencia += 1;
    const idExterno = datos.idExterno ?? `${Date.now()}${secuencia}`;
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

  const nuevoIdEvento = (): string => {
    const id = randomUUID();
    eventosCreados.push(id);
    return id;
  };

  const notificar = (
    idPago: string,
    idEvento: string,
    { secreto = SECRETO }: { secreto?: string } = {},
  ) => {
    const idSolicitud = randomUUID();
    const ts = String(Math.floor(Date.now() / 1000));
    const hash = createHmac('sha256', secreto)
      .update(`id:${idPago};request-id:${idSolicitud};ts:${ts};`)
      .digest('hex');
    return request(app.getHttpServer())
      .post(`${RUTA}?data.id=${idPago}&type=payment`)
      .set('x-signature', `ts=${ts},v1=${hash}`)
      .set('x-request-id', idSolicitud)
      .send({
        id: idEvento,
        type: 'payment',
        action: 'payment.updated',
        live_mode: false,
        user_id: 1,
        api_version: 'v1',
        date_created: new Date().toISOString(),
        data: { id: idPago },
      });
  };

  const eventoTerminado = (idEvento: string, estado = 'procesado') =>
    vi.waitFor(
      async () => {
        const evento = await prisma.eventoPago.findUniqueOrThrow({
          where: { idEventoExterno: idEvento },
        });
        expect(evento.estadoProcesamiento).toBe(estado);
        return evento;
      },
      { timeout: 10_000, interval: 50 },
    );

  const correosDelPedido = async (codigoPedido: string) => {
    const trabajos: Job<TrabajoPagoConfirmado>[] = await correos.getJobs([
      'prioritized',
      'waiting',
      'delayed',
    ]);
    return trabajos.filter(
      (t) =>
        t.name === TRABAJOS_CORREO.PAGO_CONFIRMADO &&
        t.data.codigoPedido === codigoPedido,
    );
  };

  const limpiar = async () => {
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
    await prisma.pedido.deleteMany({ where: donde });
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: PREFIJO_CORREO } },
    });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PasarelaPago)
      .useValue(pasarela)
      .compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    correos = app.get(getQueueToken(COLAS.CORREOS));
    await limpiar();
    const usuario = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Marcela',
        apellido: 'Soto',
        email,
        contrasenaHash: await argon2.hash(CONTRASENA),
        rol: ROLES.CLIENTE,
        fechaVerificacionCorreo: new Date(),
      },
    });
    usuarioId = usuario.id;
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  it('E6-H2 · notificación recibida: actualiza el pago y el pedido y encola el correo de confirmación', async () => {
    const pedido = await nuevoPedido();
    const pagoId = pagoEnMp(pedido.codigo);
    const idEvento = nuevoIdEvento();

    await notificar(pagoId, idEvento).expect(200);

    const evento = await eventoTerminado(idEvento);
    const pago = await prisma.pago.findUniqueOrThrow({
      where: { idTransaccionExterna: pagoId },
    });
    expect(pago).toMatchObject({
      pedidoId: pedido.id,
      estado: 'aprobado',
      monto: TOTAL,
    });
    expect(evento.pagoId).toBe(pago.id);
    expect(JSON.parse(evento.contenidoRecibido ?? '')).toEqual({
      id: idEvento,
      tipo: 'payment',
      accion: 'payment.updated',
      idPago: pagoId,
    });

    const actualizado = await prisma.pedido.findUniqueOrThrow({
      where: { id: pedido.id },
      include: { historial: { orderBy: { correlativo: 'asc' } } },
    });
    expect(actualizado.estadoActual).toBe('pagado');
    expect(actualizado.historial.at(-1)).toMatchObject({
      estado: 'pagado',
      usuarioId: null,
    });

    const notificaciones = await prisma.notificacion.findMany({
      where: { pedidoId: pedido.id },
    });
    expect(notificaciones).toHaveLength(1);
    expect(notificaciones[0]).toMatchObject({
      usuarioId,
      tipo: 'pago_confirmado',
      estadoEnvio: 'pendiente',
    });
    const trabajos = await correosDelPedido(pedido.codigo);
    expect(trabajos.map((t) => t.data)).toEqual([
      {
        notificacionId: notificaciones[0].id,
        destinatario: email,
        nombre: 'Marcela',
        codigoPedido: pedido.codigo,
        montoTotal: TOTAL,
      },
    ]);
  });

  it('E6-H2 · notificación repetida: la segunda se reconoce y no repite cambios ni correos', async () => {
    const pedido = await nuevoPedido();
    const pagoId = pagoEnMp(pedido.codigo);
    const idEvento = nuevoIdEvento();

    await notificar(pagoId, idEvento).expect(200);
    const primero = await eventoTerminado(idEvento);

    await notificar(pagoId, idEvento).expect(200);
    await notificar(pagoId, idEvento).expect(200);

    const eventos = await prisma.eventoPago.findMany({
      where: { idEventoExterno: idEvento },
    });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      estadoProcesamiento: 'procesado',
      intentos: primero.intentos,
    });
    expect(await prisma.pago.count({ where: { pedidoId: pedido.id } })).toBe(1);
    expect(
      await prisma.historialEstadoPedido.count({
        where: { pedidoId: pedido.id, estado: 'pagado' },
      }),
    ).toBe(1);
    expect(
      await prisma.notificacion.count({ where: { pedidoId: pedido.id } }),
    ).toBe(1);
    expect(await correosDelPedido(pedido.codigo)).toHaveLength(1);
  });

  it('E6-H2 · dos notificaciones simultáneas de la misma: un solo evento y un solo correo', async () => {
    const pedido = await nuevoPedido();
    const pagoId = pagoEnMp(pedido.codigo);
    const idEvento = nuevoIdEvento();

    await Promise.all([
      notificar(pagoId, idEvento).expect(200),
      notificar(pagoId, idEvento).expect(200),
    ]);
    await eventoTerminado(idEvento);

    expect(
      await prisma.eventoPago.count({ where: { idEventoExterno: idEvento } }),
    ).toBe(1);
    expect(await correosDelPedido(pedido.codigo)).toHaveLength(1);
  });

  it('E6-H2 · otra notificación del mismo pago ya aplicado: se procesa sin repetir el correo', async () => {
    const pedido = await nuevoPedido();
    const pagoId = pagoEnMp(pedido.codigo);
    const primero = nuevoIdEvento();
    const segundo = nuevoIdEvento();

    await notificar(pagoId, primero).expect(200);
    await eventoTerminado(primero);
    await notificar(pagoId, segundo).expect(200);
    await eventoTerminado(segundo);

    expect(await correosDelPedido(pedido.codigo)).toHaveLength(1);
  });

  it('E6-H2 · pago que pasa de pendiente a aprobado: cada notificación se atiende y el pedido queda pagado', async () => {
    const pedido = await nuevoPedido();
    const pagoId = pagoEnMp(pedido.codigo, {
      estado: ESTADOS_PAGO.PENDIENTE,
      fechaAprobacion: null,
    });
    const creado = nuevoIdEvento();
    const aprobado = nuevoIdEvento();

    await notificar(pagoId, creado).expect(200);
    await eventoTerminado(creado);
    expect(
      (await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } }))
        .estadoActual,
    ).toBe('pendiente_pago');
    expect(await correosDelPedido(pedido.codigo)).toHaveLength(0);

    pagoEnMp(pedido.codigo, { idExterno: pagoId });
    await notificar(pagoId, aprobado).expect(200);
    await eventoTerminado(aprobado);

    expect(
      (await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } }))
        .estadoActual,
    ).toBe('pagado');
    expect(await correosDelPedido(pedido.codigo)).toHaveLength(1);
  });

  it('E6-H2 · el comprador confirma antes que la notificación: el correo sale una sola vez', async () => {
    const pedido = await nuevoPedido();
    const pagoId = pagoEnMp(pedido.codigo);
    const idEvento = nuevoIdEvento();
    const sesion = await request(app.getHttpServer())
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/pedidos/${pedido.codigo}/pago/confirmar`)
      .auth((sesion.body as { tokenAcceso: string }).tokenAcceso, {
        type: 'bearer',
      })
      .send({ pagoId })
      .expect(200);
    await notificar(pagoId, idEvento).expect(200);
    await eventoTerminado(idEvento);

    expect(await correosDelPedido(pedido.codigo)).toHaveLength(1);
    expect(
      await prisma.notificacion.count({ where: { pedidoId: pedido.id } }),
    ).toBe(1);
  });

  it('E6-H2 · firma inválida: la rechaza sin modificar el pago ni el pedido', async () => {
    const pedido = await nuevoPedido();
    const pagoId = pagoEnMp(pedido.codigo);
    const idEvento = nuevoIdEvento();

    await notificar(pagoId, idEvento, { secreto: 'otro' }).expect(401);
    await request(app.getHttpServer())
      .post(`${RUTA}?data.id=${pagoId}&type=payment`)
      .send({ id: idEvento, type: 'payment', data: { id: pagoId } })
      .expect(401);

    expect(
      await prisma.eventoPago.count({ where: { idEventoExterno: idEvento } }),
    ).toBe(0);
    expect(await prisma.pago.count({ where: { pedidoId: pedido.id } })).toBe(0);
    expect(
      (await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } }))
        .estadoActual,
    ).toBe('pendiente_pago');
    expect(await correosDelPedido(pedido.codigo)).toHaveLength(0);
  });

  it('E6-H3 · pago aprobado por otro monto: el evento queda para revisión y el pedido no cambia', async () => {
    const pedido = await nuevoPedido();
    const pagoId = pagoEnMp(pedido.codigo, { monto: 100 });
    const idEvento = nuevoIdEvento();

    await notificar(pagoId, idEvento).expect(200);
    await eventoTerminado(idEvento, 'revision_manual');

    expect(
      (await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } }))
        .estadoActual,
    ).toBe('pendiente_pago');
    expect(await correosDelPedido(pedido.codigo)).toHaveLength(0);
  });

  it('E6-H2 · la base rechaza un segundo pago aprobado del mismo pedido (índice parcial)', async () => {
    const pedido = await nuevoPedido();
    const datos = {
      pedidoId: pedido.id,
      monto: TOTAL,
      estado: ESTADOS_PAGO.APROBADO,
    };
    await prisma.pago.create({
      data: { ...datos, idTransaccionExterna: `${pedido.codigo}-1` },
    });

    await expect(
      prisma.pago.create({
        data: { ...datos, idTransaccionExterna: `${pedido.codigo}-2` },
      }),
    ).rejects.toThrow();
    await prisma.pago.create({
      data: {
        ...datos,
        estado: ESTADOS_PAGO.RECHAZADO,
        idTransaccionExterna: `${pedido.codigo}-3`,
      },
    });
  });
});
