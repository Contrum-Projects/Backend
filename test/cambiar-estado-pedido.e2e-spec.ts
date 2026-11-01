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
  type TrabajoCambioEstadoPedido,
} from '../src/colas/colas.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import {
  ESTADOS_ENVIO,
  ESTADOS_NOTIFICACION,
  ESTADOS_PEDIDO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
  TIPOS_NOTIFICACION,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO_CORREO = 'e2e-cambiar-estado-pedido-';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '94';
const COMUNA = '94001';

describe('Pedidos · cambiar el estado desde el panel (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let correos: Queue;
  let hashContrasena: string;
  let compradorId: number;
  let comunaId: number;
  const correoComprador = `${PREFIJO_CORREO}comprador-${randomUUID()}@prueba.cl`;
  const correosCreados: string[] = [correoComprador];

  const servidor = () => request(app.getHttpServer());

  const cuenta = async (rol: Rol) => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
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

  /** Un pedido del comprador con su primer cambio de estado en el historial. */
  const nuevoPedido = async (
    estado: string = ESTADOS_PEDIDO.PAGADO,
    tipoEntrega: string = TIPOS_ENTREGA.DESPACHO,
  ) => {
    const codigoPublico = randomUUID().replaceAll('-', '').slice(0, 12);
    const pedido = await prisma.pedido.create({
      data: {
        codigoPublico,
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
    return { id: pedido.id, codigo: codigoPublico };
  };

  const cambiar = (token: string, codigo: string, cuerpo?: object) =>
    servidor()
      .post(`/api/pedidos/${codigo}/estado`)
      .auth(token, { type: 'bearer' })
      .send(cuerpo);

  const estadoDe = async (id: number) =>
    (await prisma.pedido.findUniqueOrThrow({ where: { id } })).estadoActual;

  const historialDe = (id: number) =>
    prisma.historialEstadoPedido.findMany({
      where: { pedidoId: id },
      orderBy: { correlativo: 'asc' },
    });

  const notificacionesDe = (id: number) =>
    prisma.notificacion.findMany({
      where: { pedidoId: id },
      orderBy: { id: 'asc' },
    });

  const trabajosDe = async (codigo: string) => {
    const trabajos: Job<TrabajoCambioEstadoPedido>[] = await correos.getJobs([
      'prioritized',
      'waiting',
      'delayed',
    ]);
    return trabajos.filter(
      (t) =>
        t.name === TRABAJOS_CORREO.CAMBIO_ESTADO_PEDIDO &&
        t.data.codigoPedido === codigo,
    );
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
    // Las notificaciones quedan sueltas (SET NULL) si se borra primero el pedido o la cuenta
    await prisma.notificacion.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
    // El historial se borra en cascada con el pedido
    await prisma.pedido.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    correos = app.get(getQueueToken(COLAS.CORREOS));
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiar();

    const region = await prisma.region.upsert({
      where: { codigoCut: REGION },
      update: {},
      create: { codigoCut: REGION, nombre: 'Región de prueba cambio estado' },
    });
    comunaId = (
      await prisma.comuna.upsert({
        where: { codigoCut: COMUNA },
        update: {},
        create: {
          codigoCut: COMUNA,
          nombre: 'Comuna de prueba cambio estado',
          regionId: region.id,
        },
      })
    ).id;

    compradorId = (
      await prisma.usuario.create({
        data: {
          codigoPublico: randomUUID(),
          nombre: 'Camila',
          apellido: 'Rojas',
          email: correoComprador,
          contrasenaHash: 'sin-uso',
          rol: ROLES.CLIENTE,
          fechaVerificacionCorreo: new Date(),
        },
      })
    ).id;
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiar();
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E8-H2 · pedido pagado a «en preparación»: guarda el cambio con fecha, quién lo hizo y el comentario, y no envía correo', async () => {
    const personal = await cuenta(ROLES.BODEGUERO);
    const pedido = await nuevoPedido();

    const respuesta = await cambiar(personal.token, pedido.codigo, {
      estado: 'en_preparacion',
      comentario: '  Armando el pedido.  ',
    }).expect(200);

    expect(respuesta.body).toEqual({
      codigoPublico: pedido.codigo,
      estado: ESTADOS_PEDIDO.EN_PREPARACION,
    });
    expect(await estadoDe(pedido.id)).toBe(ESTADOS_PEDIDO.EN_PREPARACION);
    const historial = await historialDe(pedido.id);
    expect(
      historial.map((cambio) => ({
        correlativo: cambio.correlativo,
        estado: cambio.estado,
        usuarioId: cambio.usuarioId,
        comentario: cambio.comentario,
      })),
    ).toEqual([
      {
        correlativo: 1,
        estado: ESTADOS_PEDIDO.PAGADO,
        usuarioId: null,
        comentario: null,
      },
      {
        correlativo: 2,
        estado: ESTADOS_PEDIDO.EN_PREPARACION,
        usuarioId: personal.usuarioId,
        comentario: 'Armando el pedido.',
      },
    ]);
    expect(historial[1].fechaHora).toBeInstanceOf(Date);
    // «En preparación» no es un cambio clave: sin notificación ni correo
    expect(await notificacionesDe(pedido.id)).toHaveLength(0);
    expect(await trabajosDe(pedido.codigo)).toHaveLength(0);
  });

  it('E8-H2 · despacho: los cambios clave («despachado», «entregado») guardan la notificación pendiente y encolan el correo al cliente con el nuevo estado', async () => {
    const personal = await cuenta(ROLES.VENDEDOR);
    const pedido = await nuevoPedido(
      ESTADOS_PEDIDO.EN_PREPARACION,
      TIPOS_ENTREGA.DESPACHO,
    );

    await cambiar(personal.token, pedido.codigo, {
      estado: 'despachado',
      codigoSeguimiento: '990000000001',
    }).expect(200);
    await cambiar(personal.token, pedido.codigo, {
      estado: 'entregado',
    }).expect(200);

    expect(await estadoDe(pedido.id)).toBe(ESTADOS_PEDIDO.ENTREGADO);
    const notificaciones = await notificacionesDe(pedido.id);
    expect(
      notificaciones.map((n) => ({
        usuarioId: n.usuarioId,
        tipo: n.tipo,
        asunto: n.asunto,
        estadoEnvio: n.estadoEnvio,
      })),
    ).toEqual([
      {
        usuarioId: compradorId,
        tipo: TIPOS_NOTIFICACION.CAMBIO_ESTADO_PEDIDO,
        asunto: `Tu pedido ${pedido.codigo} está despachado`,
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
      },
      {
        usuarioId: compradorId,
        tipo: TIPOS_NOTIFICACION.CAMBIO_ESTADO_PEDIDO,
        asunto: `Tu pedido ${pedido.codigo} está entregado`,
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
      },
    ]);
    const trabajos = (await trabajosDe(pedido.codigo)).sort(
      (a, b) => a.data.notificacionId - b.data.notificacionId,
    );
    expect(trabajos.map((t) => t.data)).toEqual([
      {
        notificacionId: notificaciones[0].id,
        destinatario: correoComprador,
        nombre: 'Camila',
        codigoPedido: pedido.codigo,
        estado: ESTADOS_PEDIDO.DESPACHADO,
        tipoEntrega: TIPOS_ENTREGA.DESPACHO,
      },
      {
        notificacionId: notificaciones[1].id,
        destinatario: correoComprador,
        nombre: 'Camila',
        codigoPedido: pedido.codigo,
        estado: ESTADOS_PEDIDO.ENTREGADO,
        tipoEntrega: TIPOS_ENTREGA.DESPACHO,
      },
    ]);
  });

  it('E8-H2 · retiro en tienda: «listo para retiro» avisa al cliente y después se puede marcar «retirado», que también avisa', async () => {
    const personal = await cuenta(ROLES.VENDEDOR);
    const pedido = await nuevoPedido(
      ESTADOS_PEDIDO.EN_PREPARACION,
      TIPOS_ENTREGA.RETIRO,
    );

    await cambiar(personal.token, pedido.codigo, {
      estado: 'listo_para_retiro',
    }).expect(200);

    expect(await estadoDe(pedido.id)).toBe(ESTADOS_PEDIDO.LISTO_PARA_RETIRO);
    const avisos = await trabajosDe(pedido.codigo);
    expect(avisos.map((t) => t.data)).toMatchObject([
      {
        destinatario: correoComprador,
        estado: ESTADOS_PEDIDO.LISTO_PARA_RETIRO,
        tipoEntrega: TIPOS_ENTREGA.RETIRO,
      },
    ]);

    await cambiar(personal.token, pedido.codigo, {
      estado: 'retirado',
    }).expect(200);

    expect(await estadoDe(pedido.id)).toBe(ESTADOS_PEDIDO.RETIRADO);
    const todos = (await trabajosDe(pedido.codigo)).sort(
      (a, b) => a.data.notificacionId - b.data.notificacionId,
    );
    expect(todos.map((t) => t.data.estado)).toEqual([
      ESTADOS_PEDIDO.LISTO_PARA_RETIRO,
      ESTADOS_PEDIDO.RETIRADO,
    ]);
    expect(await notificacionesDe(pedido.id)).toHaveLength(2);
  });

  it('E8-H2 · cambio que la secuencia no permite (saltarse un paso, estado de otra entrega, pago o cancelación): 409 y no cambia nada', async () => {
    const personal = await cuenta(ROLES.ADMINISTRADOR);
    const casos: [string, string, string][] = [
      [ESTADOS_PEDIDO.PAGADO, 'despachado', TIPOS_ENTREGA.DESPACHO],
      [ESTADOS_PEDIDO.PAGADO, 'pagado', TIPOS_ENTREGA.DESPACHO],
      [
        ESTADOS_PEDIDO.EN_PREPARACION,
        'listo_para_retiro',
        TIPOS_ENTREGA.DESPACHO,
      ],
      [ESTADOS_PEDIDO.EN_PREPARACION, 'despachado', TIPOS_ENTREGA.RETIRO],
      [ESTADOS_PEDIDO.PENDIENTE_PAGO, 'pagado', TIPOS_ENTREGA.DESPACHO],
      [ESTADOS_PEDIDO.PAGADO, 'pendiente_pago', TIPOS_ENTREGA.DESPACHO],
      [ESTADOS_PEDIDO.PAGADO, 'cancelado', TIPOS_ENTREGA.DESPACHO],
      [ESTADOS_PEDIDO.CANCELADO, 'pagado', TIPOS_ENTREGA.DESPACHO],
    ];

    for (const [actual, destino, tipoEntrega] of casos) {
      const pedido = await nuevoPedido(actual, tipoEntrega);

      const respuesta = await cambiar(personal.token, pedido.codigo, {
        estado: destino,
        comentario: 'Intento.',
      }).expect(409);

      expect(respuesta.body).toMatchObject({
        message: expect.stringContaining('No se puede cambiar un pedido de'),
      });
      expect(await estadoDe(pedido.id)).toBe(actual);
      expect(await historialDe(pedido.id)).toHaveLength(1);
      expect(await notificacionesDe(pedido.id)).toHaveLength(0);
    }
  });

  it('E8-H2 · volver a un estado anterior exige comentario, queda en el historial y no avisa al cliente', async () => {
    const personal = await cuenta(ROLES.VENDEDOR);
    const pedido = await nuevoPedido(ESTADOS_PEDIDO.DESPACHADO);

    const sinComentario = await cambiar(personal.token, pedido.codigo, {
      estado: 'en_preparacion',
    }).expect(400);
    expect(sinComentario.body).toMatchObject({
      message: 'El comentario es obligatorio al volver a un estado anterior.',
    });
    await cambiar(personal.token, pedido.codigo, {
      estado: 'en_preparacion',
      comentario: '   ',
    }).expect(400);
    expect(await estadoDe(pedido.id)).toBe(ESTADOS_PEDIDO.DESPACHADO);

    await cambiar(personal.token, pedido.codigo, {
      estado: 'en_preparacion',
      comentario: 'Se marcó despachado por error.',
    }).expect(200);

    expect(await estadoDe(pedido.id)).toBe(ESTADOS_PEDIDO.EN_PREPARACION);
    expect((await historialDe(pedido.id)).at(-1)).toMatchObject({
      correlativo: 2,
      estado: ESTADOS_PEDIDO.EN_PREPARACION,
      usuarioId: personal.usuarioId,
      comentario: 'Se marcó despachado por error.',
    });
    expect(await notificacionesDe(pedido.id)).toHaveLength(0);
    expect(await trabajosDe(pedido.codigo)).toHaveLength(0);
  });

  it('E8-H2 · cliente y profesional no pueden cambiar el estado (403), ni sin sesión (401)', async () => {
    const pedido = await nuevoPedido();

    for (const rol of [ROLES.CLIENTE, ROLES.PROFESIONAL]) {
      const comprador = await cuenta(rol);
      await cambiar(comprador.token, pedido.codigo, {
        estado: 'en_preparacion',
      }).expect(403);
    }
    await servidor()
      .post(`/api/pedidos/${pedido.codigo}/estado`)
      .send({ estado: 'en_preparacion' })
      .expect(401);

    expect(await estadoDe(pedido.id)).toBe(ESTADOS_PEDIDO.PAGADO);
    expect(await historialDe(pedido.id)).toHaveLength(1);
  });

  it('E8-H2 · pedido inexistente o con un código mal formado: 404', async () => {
    const personal = await cuenta(ROLES.VENDEDOR);

    for (const codigo of ['ZZZZZZZZZZZZ', 'corto', '12345678901234567890']) {
      const respuesta = await cambiar(personal.token, codigo, {
        estado: 'en_preparacion',
      }).expect(404);
      expect(respuesta.body).toMatchObject({ message: 'El pedido no existe.' });
    }
  });

  it('E8-H2 · estado que no existe, comentario demasiado largo o campos de más: 400 y el pedido no cambia', async () => {
    const personal = await cuenta(ROLES.VENDEDOR);
    const pedido = await nuevoPedido();

    await cambiar(personal.token, pedido.codigo, {}).expect(400);
    await cambiar(personal.token, pedido.codigo, { estado: 'volando' }).expect(
      400,
    );
    await cambiar(personal.token, pedido.codigo, {
      estado: 'en_preparacion',
      comentario: 'x'.repeat(501),
    }).expect(400);
    await cambiar(personal.token, pedido.codigo, {
      estado: 'en_preparacion',
      usuarioId: 1,
    }).expect(400);

    expect(await estadoDe(pedido.id)).toBe(ESTADOS_PEDIDO.PAGADO);
    expect(await historialDe(pedido.id)).toHaveLength(1);
  });

  it('RNF-12 · dos cambios simultáneos al mismo estado: uno gana, el otro recibe 409 y el historial queda con un solo cambio', async () => {
    const personal = await cuenta(ROLES.ADMINISTRADOR);
    const pedido = await nuevoPedido(ESTADOS_PEDIDO.EN_PREPARACION);

    const respuestas = await Promise.all([
      cambiar(personal.token, pedido.codigo, {
        estado: 'despachado',
        codigoSeguimiento: '990000000001',
      }),
      cambiar(personal.token, pedido.codigo, {
        estado: 'despachado',
        codigoSeguimiento: '990000000001',
      }),
    ]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await estadoDe(pedido.id)).toBe(ESTADOS_PEDIDO.DESPACHADO);
    expect(await historialDe(pedido.id)).toHaveLength(2);
    expect(await notificacionesDe(pedido.id)).toHaveLength(1);
    expect(await trabajosDe(pedido.codigo)).toHaveLength(1);
  });
});
