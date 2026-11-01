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
import {
  COLAS,
  TRABAJOS_CORREO,
  TRABAJOS_SEGUIMIENTO,
  type TrabajoCambioEstadoPedido,
} from '../src/colas/colas.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import {
  ESTADOS_ENVIO,
  ESTADOS_PEDIDO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
  type Valor,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { ActualizarEnviosService } from '../src/modulos/despacho/actualizar-envios.service.js';
import {
  type ConsultaSeguimiento,
  SeguimientoEnvio,
} from '../src/modulos/despacho/seguimiento-envio.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const PREFIJO_CORREO = 'e2e-seguimiento-despacho-';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '95';
const COMUNA = '95001';

type EstadoEnvio = Valor<typeof ESTADOS_ENVIO>;

/** El courier de las pruebas: responde lo que indique cada una. */
class SeguimientoDePrueba extends SeguimientoEnvio {
  readonly estados = new Map<string, EstadoEnvio>();
  readonly consultados: string[] = [];

  consultar({
    codigoSeguimiento,
  }: ConsultaSeguimiento): Promise<EstadoEnvio | null> {
    this.consultados.push(codigoSeguimiento);
    return Promise.resolve(this.estados.get(codigoSeguimiento) ?? null);
  }
}

describe('Despacho · estado y código de seguimiento (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let correos: Queue;
  let hashContrasena: string;
  let comunaId: number;
  let envios: ActualizarEnviosService;
  const courier = new SeguimientoDePrueba();

  const servidor = () => request(app.getHttpServer());

  const cuenta = async (rol: Rol) => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
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

  const nuevoPedido = async (
    compradorId: number,
    estado: string = ESTADOS_PEDIDO.EN_PREPARACION,
    tipoEntrega: string = TIPOS_ENTREGA.DESPACHO,
  ) => {
    const codigo = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
    const pedido = await prisma.pedido.create({
      data: {
        codigoPublico: codigo,
        usuarioId: compradorId,
        fechaExpiracionPago: new Date(Date.now() + 15 * 60_000),
        estadoActual: estado,
        tipoEntrega,
        tipoDocumentoSolicitado: TIPOS_DOCUMENTO.BOLETA,
        porcentajeIva: 19,
        montoNeto: 0,
        montoIva: 0,
        montoTotal: 0,
        historial: { create: [{ correlativo: 1, estado }] },
        ...(tipoEntrega === TIPOS_ENTREGA.DESPACHO && {
          envio: {
            create: {
              comunaId,
              servicioEnvio: 'EXPRESS',
              costoNeto: 3000,
              estadoEnvio: ESTADOS_ENVIO.PENDIENTE,
              destinatario: 'Camila Rojas',
              calle: 'Av. Prueba',
              numero: '123',
            },
          },
        }),
      },
    });
    return { id: pedido.id, codigo };
  };

  const cambiar = (token: string, codigo: string, cuerpo: object) =>
    servidor()
      .post(`/api/pedidos/${codigo}/estado`)
      .auth(token, { type: 'bearer' })
      .send(cuerpo);

  const envioDe = async (token: string, codigo: string) => {
    const respuesta = await servidor()
      .get(`/api/pedidos/${codigo}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    return respuesta.body as {
      estado: string;
      envio: {
        servicio: string;
        estado: string;
        codigoSeguimiento: string | null;
      };
    };
  };

  /** Comprador con sesión y personal listos, y un pedido ya despachado con código. */
  const pedidoDespachado = async (ot: string) => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const personal = await cuenta(ROLES.BODEGUERO);
    const pedido = await nuevoPedido(comprador.usuarioId);
    await cambiar(personal.token, pedido.codigo, {
      estado: 'despachado',
      codigoSeguimiento: ot,
    }).expect(200);
    return { comprador, personal, pedido };
  };

  const limpiar = async () => {
    const trabajos: Job<TrabajoCambioEstadoPedido>[] = await correos.getJobs([
      'prioritized',
      'waiting',
      'delayed',
    ]);
    for (const trabajo of trabajos) {
      if (trabajo.data.destinatario?.startsWith(PREFIJO_CORREO)) {
        await trabajo.remove();
      }
    }
    await prisma.notificacion.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
    await prisma.pedido.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: PREFIJO_CORREO } },
    });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SeguimientoEnvio)
      .useValue(courier)
      .compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    correos = app.get(getQueueToken(COLAS.CORREOS));
    envios = app.get(ActualizarEnviosService);
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiar();

    const region = await prisma.region.upsert({
      where: { codigoCut: REGION },
      update: {},
      create: { codigoCut: REGION, nombre: 'Región de prueba seguimiento' },
    });
    comunaId = (
      await prisma.comuna.upsert({
        where: { codigoCut: COMUNA },
        update: {},
        create: {
          codigoCut: COMUNA,
          nombre: 'Comuna de prueba seguimiento',
          regionId: region.id,
        },
      })
    ).id;
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiar();
    courier.estados.clear();
    courier.consultados.length = 0;
  });

  afterAll(async () => {
    await limpiar();
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E7-H3 · envío registrado: al despachar, el pedido devuelve el servicio, el código de seguimiento y el estado del envío', async () => {
    const { comprador, pedido } = await pedidoDespachado('990000000001');

    expect(await envioDe(comprador.token, pedido.codigo)).toMatchObject({
      estado: ESTADOS_PEDIDO.DESPACHADO,
      envio: {
        servicio: 'EXPRESS',
        codigoSeguimiento: '990000000001',
        estado: ESTADOS_ENVIO.EN_TRANSITO,
      },
    });
  });

  it('E7-H3 · despachar sin código, o enviarlo en otro cambio: 400 y el pedido no cambia', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const personal = await cuenta(ROLES.VENDEDOR);
    const pedido = await nuevoPedido(comprador.usuarioId);

    await cambiar(personal.token, pedido.codigo, {
      estado: 'despachado',
    }).expect(400);
    await cambiar(personal.token, pedido.codigo, {
      estado: 'en_preparacion',
      codigoSeguimiento: '990000000001',
      comentario: 'Intento.',
    }).expect(409);
    const pagado = await nuevoPedido(
      comprador.usuarioId,
      ESTADOS_PEDIDO.PAGADO,
    );
    await cambiar(personal.token, pagado.codigo, {
      estado: 'en_preparacion',
      codigoSeguimiento: '990000000001',
    }).expect(400);

    expect(await envioDe(comprador.token, pedido.codigo)).toMatchObject({
      estado: ESTADOS_PEDIDO.EN_PREPARACION,
      envio: {
        codigoSeguimiento: null,
        estado: ESTADOS_ENVIO.PENDIENTE,
      },
    });
  });

  it('E7-H3 · cada OT es de un solo pedido: repetirla responde 409, y se libera al quitarla del primero', async () => {
    const ot = '990000000006';
    const { comprador, personal, pedido } = await pedidoDespachado(ot);
    const otro = await nuevoPedido(comprador.usuarioId);

    const repetida = await cambiar(personal.token, otro.codigo, {
      estado: 'despachado',
      codigoSeguimiento: ot,
    }).expect(409);
    expect(repetida.body).toMatchObject({
      message: 'Ese código de seguimiento ya está registrado en otro pedido.',
    });
    expect(await envioDe(comprador.token, otro.codigo)).toMatchObject({
      estado: ESTADOS_PEDIDO.EN_PREPARACION,
      envio: { codigoSeguimiento: null, estado: ESTADOS_ENVIO.PENDIENTE },
    });

    await cambiar(personal.token, pedido.codigo, {
      estado: 'en_preparacion',
      comentario: 'La OT era del otro pedido.',
    }).expect(200);
    await cambiar(personal.token, otro.codigo, {
      estado: 'despachado',
      codigoSeguimiento: ot,
    }).expect(200);
  });

  it('E7-H3 · dos pedidos despachados a la vez con la misma OT: uno gana y el otro recibe 409', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const personal = await cuenta(ROLES.BODEGUERO);
    const pedidos = await Promise.all([
      nuevoPedido(comprador.usuarioId),
      nuevoPedido(comprador.usuarioId),
    ]);

    const respuestas = await Promise.all(
      pedidos.map((pedido) =>
        cambiar(personal.token, pedido.codigo, {
          estado: 'despachado',
          codigoSeguimiento: '990000000007',
        }),
      ),
    );

    expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('E7-H3 · cliente y profesional no pueden registrar el código (403), ni sin sesión (401)', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const pedido = await nuevoPedido(comprador.usuarioId);

    for (const rol of [ROLES.CLIENTE, ROLES.PROFESIONAL]) {
      const otro = await cuenta(rol);
      await cambiar(otro.token, pedido.codigo, {
        estado: 'despachado',
        codigoSeguimiento: '990000000001',
      }).expect(403);
    }
    await servidor()
      .post(`/api/pedidos/${pedido.codigo}/estado`)
      .send({ estado: 'despachado', codigoSeguimiento: '990000000001' })
      .expect(401);
  });

  it('E7-H3 · estado actualizado: Chilexpress informa un nuevo estado y la API lo devuelve al cliente', async () => {
    const { comprador, pedido } = await pedidoDespachado('990000000002');
    courier.estados.set('990000000002', ESTADOS_ENVIO.EN_REPARTO);

    await envios.actualizar();

    expect(await envioDe(comprador.token, pedido.codigo)).toMatchObject({
      estado: ESTADOS_PEDIDO.DESPACHADO,
      envio: { estado: ESTADOS_ENVIO.EN_REPARTO },
    });
  });

  it('E7-H3 · Chilexpress informa la entrega: pedido entregado, historial sin usuario y correo al cliente', async () => {
    const { comprador, pedido } = await pedidoDespachado('990000000003');
    courier.estados.set('990000000003', ESTADOS_ENVIO.ENTREGADO);

    await envios.actualizar();

    expect(await envioDe(comprador.token, pedido.codigo)).toMatchObject({
      estado: ESTADOS_PEDIDO.ENTREGADO,
      envio: { estado: ESTADOS_ENVIO.ENTREGADO },
    });
    const historial = await prisma.historialEstadoPedido.findMany({
      where: { pedidoId: pedido.id },
      orderBy: { correlativo: 'asc' },
    });
    expect(historial.at(-1)).toMatchObject({
      estado: ESTADOS_PEDIDO.ENTREGADO,
      usuarioId: null,
    });
    const avisos = (
      (await correos.getJobs([
        'prioritized',
        'waiting',
        'delayed',
      ])) as Job<TrabajoCambioEstadoPedido>[]
    ).filter(
      (t) =>
        t.name === TRABAJOS_CORREO.CAMBIO_ESTADO_PEDIDO &&
        t.data.codigoPedido === pedido.codigo &&
        t.data.estado === ESTADOS_PEDIDO.ENTREGADO,
    );
    expect(avisos).toHaveLength(1);
  });

  it('E7-H3 · el personal devuelve un pedido entregado: el envío queda con problema y la tarea ya no lo vuelve a entregar', async () => {
    const { comprador, personal, pedido } =
      await pedidoDespachado('990000000004');
    await cambiar(personal.token, pedido.codigo, {
      estado: 'entregado',
    }).expect(200);
    await cambiar(personal.token, pedido.codigo, {
      estado: 'despachado',
      comentario: 'El cliente no lo recibió.',
    }).expect(200);
    courier.estados.set('990000000004', ESTADOS_ENVIO.ENTREGADO);

    await envios.actualizar();

    expect(courier.consultados).not.toContain('990000000004');
    expect(await envioDe(comprador.token, pedido.codigo)).toMatchObject({
      estado: ESTADOS_PEDIDO.DESPACHADO,
      envio: { estado: ESTADOS_ENVIO.CON_PROBLEMA },
    });
  });

  it('E7-H3 · volver a en preparación borra el código y la tarea deja de consultarlo', async () => {
    const { comprador, personal, pedido } =
      await pedidoDespachado('990000000005');
    await cambiar(personal.token, pedido.codigo, {
      estado: 'en_preparacion',
      comentario: 'OT equivocada.',
    }).expect(200);

    await envios.actualizar();

    expect(courier.consultados).not.toContain('990000000005');
    expect(await envioDe(comprador.token, pedido.codigo)).toMatchObject({
      envio: { codigoSeguimiento: null, estado: ESTADOS_ENVIO.PENDIENTE },
    });
  });

  it('RNF-29 · Redis vuelve sin sus datos: al reconectar crea de nuevo la tarea de seguimiento', async () => {
    const cola = app.get<Queue>(getQueueToken(COLAS.SEGUIMIENTO_ENVIOS));
    const tarea = TRABAJOS_SEGUIMIENTO.ACTUALIZAR_ENVIOS;
    await cola.removeJobScheduler(tarea);
    expect(await cola.getJobScheduler(tarea)).toBeUndefined();

    (await cola.getBackend().client).disconnect(true);

    await vi.waitFor(
      async () => expect(await cola.getJobScheduler(tarea)).toBeDefined(),
      { timeout: 10_000, interval: 100 },
    );
  });
});
