import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  CambiarEstadoPedidoService,
  CODIGO_AL_DESPACHAR,
  CODIGO_SOLO_AL_DESPACHAR,
  COMENTARIO_AL_RETROCEDER,
  COMENTARIO_ENTREGA_COURIER,
  estadoNoPermitido,
  OT_YA_REGISTRADA,
  PEDIDO_SIN_ENVIO,
} from './cambiar-estado-pedido.service.js';

const PERSONAL = '3f0c2a52-0b9e-4c55-9d0e-6a3a4f6d1b2c';
const CODIGO = 'AB12CD34EF56';

const crearDb = () => {
  const db = {
    $queryRaw: vi
      .fn()
      .mockResolvedValue([
        { id: 40, estado: 'pagado', tipoEntrega: 'despacho', compradorId: 9 },
      ]),
    usuario: {
      findUniqueOrThrow: vi
        .fn()
        .mockImplementation(({ where }: { where: object }) =>
          'codigoPublico' in where
            ? { id: 7 }
            : { email: 'camila@prueba.cl', nombre: 'Camila' },
        ),
    },
    historialEstadoPedido: {
      aggregate: vi.fn().mockResolvedValue({ _max: { correlativo: 1 } }),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
    },
    pedido: { update: vi.fn().mockResolvedValue({}) },
    envio: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    notificacion: { create: vi.fn().mockResolvedValue({ id: 55 }) },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((fn: (t: typeof db) => Promise<unknown>) =>
    fn(db),
  );
  return db;
};

describe('CambiarEstadoPedidoService', () => {
  let db: ReturnType<typeof crearDb>;
  let correos: {
    add: ReturnType<typeof vi.fn>;
    addBulk: ReturnType<typeof vi.fn>;
  };
  let servicio: CambiarEstadoPedidoService;

  const pedidoEn = (estado: string, tipoEntrega = 'despacho') =>
    db.$queryRaw.mockResolvedValue([
      { id: 40, estado, tipoEntrega, compradorId: 9 },
    ]);

  beforeEach(() => {
    db = crearDb();
    correos = {
      add: vi.fn().mockResolvedValue({}),
      addBulk: vi.fn().mockResolvedValue([]),
    };
    servicio = new CambiarEstadoPedidoService(
      db as unknown as PrismaService,
      correos as unknown as Queue,
    );
  });

  it('E8-H2 · pedido pagado a en preparación: guarda el cambio con quién lo hizo y el comentario, sin correo', async () => {
    const respuesta = await servicio.cambiar(PERSONAL, CODIGO, {
      estado: 'en_preparacion',
      comentario: 'Armando el pedido.',
    });

    expect(respuesta).toEqual({
      codigoPublico: CODIGO,
      estado: 'en_preparacion',
    });
    expect(db.usuario.findUniqueOrThrow.mock.calls[0][0].where).toEqual({
      codigoPublico: PERSONAL,
    });
    expect(db.historialEstadoPedido.create.mock.calls[0][0].data).toEqual({
      pedidoId: 40,
      correlativo: 2,
      usuarioId: 7,
      estado: 'en_preparacion',
      comentario: 'Armando el pedido.',
    });
    expect(db.pedido.update.mock.calls[0][0]).toEqual({
      where: { id: 40 },
      data: { estadoActual: 'en_preparacion' },
    });
    expect(db.notificacion.create).not.toHaveBeenCalled();
    expect(correos.add).not.toHaveBeenCalled();
  });

  it('el comentario puede faltar al avanzar y el primer cambio lleva el correlativo 1', async () => {
    db.historialEstadoPedido.aggregate.mockResolvedValue({
      _max: { correlativo: null },
    });

    await servicio.cambiar(PERSONAL, CODIGO, { estado: 'en_preparacion' });

    const datos = db.historialEstadoPedido.create.mock.calls[0][0].data;
    expect(datos.correlativo).toBe(1);
    expect(datos.comentario).toBeUndefined();
  });

  it('E8-H2 · cambio clave: guarda la notificación pendiente en la transacción y encola el correo al cliente después', async () => {
    pedidoEn('en_preparacion', 'despacho');

    await servicio.cambiar(PERSONAL, CODIGO, {
      estado: 'despachado',
      codigoSeguimiento: 'OT1',
    });

    expect(db.notificacion.create.mock.calls[0][0].data).toEqual({
      usuarioId: 9,
      pedidoId: 40,
      tipo: 'cambio_estado_pedido',
      asunto: `Tu pedido ${CODIGO} está despachado`,
      estadoEnvio: 'pendiente',
    });
    expect(correos.add).toHaveBeenCalledTimes(1);
    const [nombre, datos] = correos.add.mock.calls[0];
    expect(nombre).toBe('cambio-estado-pedido');
    expect(datos).toEqual({
      notificacionId: 55,
      destinatario: 'camila@prueba.cl',
      nombre: 'Camila',
      codigoPedido: CODIGO,
      estado: 'despachado',
      tipoEntrega: 'despacho',
    });
  });

  it('E8-H2 · retiro en tienda: «listo para retiro» avisa al cliente y después se puede pasar a «retirado», que también avisa', async () => {
    pedidoEn('en_preparacion', 'retiro');
    await servicio.cambiar(PERSONAL, CODIGO, { estado: 'listo_para_retiro' });
    expect(correos.add.mock.calls[0][1]).toMatchObject({
      estado: 'listo_para_retiro',
      tipoEntrega: 'retiro',
    });

    correos.add.mockClear();
    pedidoEn('listo_para_retiro', 'retiro');
    const respuesta = await servicio.cambiar(PERSONAL, CODIGO, {
      estado: 'retirado',
    });
    expect(respuesta.estado).toBe('retirado');
    expect(correos.add).toHaveBeenCalledTimes(1);
    expect(correos.add.mock.calls[0][1]).toMatchObject({
      estado: 'retirado',
      tipoEntrega: 'retiro',
    });
  });

  it('volver atrás exige comentario, no avisa al cliente y se guarda en el historial', async () => {
    pedidoEn('despachado');

    await expect(
      servicio.cambiar(PERSONAL, CODIGO, { estado: 'en_preparacion' }),
    ).rejects.toThrow(new BadRequestException(COMENTARIO_AL_RETROCEDER));
    expect(db.historialEstadoPedido.create).not.toHaveBeenCalled();

    const respuesta = await servicio.cambiar(PERSONAL, CODIGO, {
      estado: 'en_preparacion',
      comentario: 'Se despachó por error.',
    });
    expect(respuesta.estado).toBe('en_preparacion');
    expect(db.historialEstadoPedido.create).toHaveBeenCalledTimes(1);
    expect(db.notificacion.create).not.toHaveBeenCalled();
    expect(correos.add).not.toHaveBeenCalled();
  });

  it('E8-H2 · cambio que la secuencia no permite: 409 y no guarda nada', async () => {
    const casos: [string, string][] = [
      ['pagado', 'despachado'],
      ['pagado', 'pagado'],
      ['pendiente_pago', 'pagado'],
      ['pagado', 'cancelado'],
      ['cancelado', 'pagado'],
    ];
    for (const [actual, destino] of casos) {
      pedidoEn(actual);

      await expect(
        servicio.cambiar(PERSONAL, CODIGO, { estado: destino }),
      ).rejects.toThrow(
        new ConflictException(estadoNoPermitido(actual, destino)),
      );
    }
    expect(db.historialEstadoPedido.create).not.toHaveBeenCalled();
    expect(db.pedido.update).not.toHaveBeenCalled();
    expect(correos.add).not.toHaveBeenCalled();
  });

  it('E7-H3 · envío registrado: al despachar guarda el código y el envío queda en tránsito', async () => {
    pedidoEn('en_preparacion');

    await servicio.cambiar(PERSONAL, CODIGO, {
      estado: 'despachado',
      codigoSeguimiento: 'OT1',
    });

    expect(db.envio.updateMany).toHaveBeenCalledWith({
      where: { pedidoId: 40 },
      data: { codigoSeguimiento: 'OT1', estadoEnvio: 'en_transito' },
    });
  });

  it('E7-H3 · despachar sin código: 400 y no guarda nada', async () => {
    pedidoEn('en_preparacion');

    await expect(
      servicio.cambiar(PERSONAL, CODIGO, { estado: 'despachado' }),
    ).rejects.toThrow(new BadRequestException(CODIGO_AL_DESPACHAR));
    expect(db.envio.updateMany).not.toHaveBeenCalled();
    expect(db.historialEstadoPedido.create).not.toHaveBeenCalled();
  });

  it('E7-H3 · código en otro cambio que no sea despachar: 400 y no guarda nada', async () => {
    await expect(
      servicio.cambiar(PERSONAL, CODIGO, {
        estado: 'en_preparacion',
        codigoSeguimiento: 'OT1',
      }),
    ).rejects.toThrow(new BadRequestException(CODIGO_SOLO_AL_DESPACHAR));
    expect(db.pedido.update).not.toHaveBeenCalled();
  });

  it('E7-H3 · pedido con despacho sin su envío: 409 al despachar', async () => {
    pedidoEn('en_preparacion');
    db.envio.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      servicio.cambiar(PERSONAL, CODIGO, {
        estado: 'despachado',
        codigoSeguimiento: 'OT1',
      }),
    ).rejects.toThrow(new ConflictException(PEDIDO_SIN_ENVIO));
    expect(db.pedido.update).not.toHaveBeenCalled();
  });

  it('E7-H3 · OT ya registrada en otro pedido: 409 y no encola ningún correo', async () => {
    pedidoEn('en_preparacion');
    db.envio.updateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('único', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      servicio.cambiar(PERSONAL, CODIGO, {
        estado: 'despachado',
        codigoSeguimiento: '123',
      }),
    ).rejects.toThrow(new ConflictException(OT_YA_REGISTRADA));
    expect(correos.add).not.toHaveBeenCalled();
  });

  it('E7-H3 · el personal marca entregado: el envío queda entregado', async () => {
    pedidoEn('despachado');

    await servicio.cambiar(PERSONAL, CODIGO, { estado: 'entregado' });

    expect(db.envio.updateMany.mock.calls[0][0].data).toEqual({
      estadoEnvio: 'entregado',
    });
  });

  it('E7-H3 · volver de despachado a en preparación: borra el código y el envío queda pendiente', async () => {
    pedidoEn('despachado');

    await servicio.cambiar(PERSONAL, CODIGO, {
      estado: 'en_preparacion',
      comentario: 'Error de bodega.',
    });

    expect(db.envio.updateMany.mock.calls[0][0].data).toEqual({
      codigoSeguimiento: null,
      estadoEnvio: 'pendiente',
    });
  });

  it('E7-H3 · volver de entregado a despachado: el envío queda con problema', async () => {
    pedidoEn('entregado');

    await servicio.cambiar(PERSONAL, CODIGO, {
      estado: 'despachado',
      comentario: 'El cliente no lo recibió.',
    });

    expect(db.envio.updateMany.mock.calls[0][0].data).toEqual({
      estadoEnvio: 'con_problema',
    });
    expect(correos.add).not.toHaveBeenCalled();
  });

  it('un pedido de retiro no toca ningún envío', async () => {
    pedidoEn('en_preparacion', 'retiro');

    await servicio.cambiar(PERSONAL, CODIGO, { estado: 'listo_para_retiro' });

    expect(db.envio.updateMany).not.toHaveBeenCalled();
  });

  describe('registrarEntregaDelCourier', () => {
    const despachado = {
      id: 40,
      codigoPublico: CODIGO,
      estado: 'despachado',
      tipoEntrega: 'despacho',
      compradorId: 9,
    };

    it('E7-H3 · Chilexpress informa la entrega: envío, pedido e historial sin usuario, y encola el correo después', async () => {
      db.$queryRaw.mockResolvedValue([despachado]);

      await servicio.registrarEntregaDelCourier(40, 'OT1');

      expect(db.envio.updateMany).toHaveBeenCalledWith({
        where: { pedidoId: 40, codigoSeguimiento: 'OT1' },
        data: { estadoEnvio: 'entregado' },
      });
      expect(db.pedido.update.mock.calls[0][0].data).toEqual({
        estadoActual: 'entregado',
      });
      expect(db.historialEstadoPedido.create.mock.calls[0][0].data).toEqual({
        pedidoId: 40,
        correlativo: 2,
        usuarioId: null,
        estado: 'entregado',
        comentario: COMENTARIO_ENTREGA_COURIER,
      });
      expect(db.notificacion.create).toHaveBeenCalledTimes(1);
      expect(correos.add.mock.calls[0][1]).toMatchObject({
        codigoPedido: CODIGO,
        estado: 'entregado',
      });
    });

    it('E7-H3 · otro estado del courier: lo guarda con el pedido bloqueado, sin historial ni correo', async () => {
      db.$queryRaw.mockResolvedValue([despachado]);

      await servicio.actualizarEstadoDelEnvio(40, 'OT1', 'en_reparto');

      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      expect(db.envio.updateMany).toHaveBeenCalledWith({
        where: { pedidoId: 40, codigoSeguimiento: 'OT1' },
        data: { estadoEnvio: 'en_reparto' },
      });
      expect(db.historialEstadoPedido.create).not.toHaveBeenCalled();
      expect(correos.add).not.toHaveBeenCalled();
    });

    it('E7-H3 · otro estado del courier tras una corrección del personal: no pisa el envío', async () => {
      db.$queryRaw.mockResolvedValue([despachado]);
      db.historialEstadoPedido.count.mockResolvedValue(1);
      await servicio.actualizarEstadoDelEnvio(40, 'OT1', 'en_reparto');

      db.historialEstadoPedido.count.mockResolvedValue(0);
      db.$queryRaw.mockResolvedValue([
        { ...despachado, estado: 'en_preparacion' },
      ]);
      await servicio.actualizarEstadoDelEnvio(40, 'OT1', 'en_reparto');

      expect(db.envio.updateMany).not.toHaveBeenCalled();
    });

    it('el pedido ya no está despachado: no cambia nada', async () => {
      db.$queryRaw.mockResolvedValue([
        { ...despachado, estado: 'en_preparacion' },
      ]);

      await servicio.registrarEntregaDelCourier(40, 'OT1');

      expect(db.envio.updateMany).not.toHaveBeenCalled();
      expect(db.pedido.update).not.toHaveBeenCalled();
      expect(correos.add).not.toHaveBeenCalled();
    });

    it('el personal ya lo devolvió desde entregado: no lo vuelve a entregar', async () => {
      db.$queryRaw.mockResolvedValue([despachado]);
      db.historialEstadoPedido.count.mockResolvedValue(1);

      await servicio.registrarEntregaDelCourier(40, 'OT1');

      expect(db.pedido.update).not.toHaveBeenCalled();
      expect(correos.add).not.toHaveBeenCalled();
    });

    it('el código cambió durante la consulta: no cambia el pedido', async () => {
      db.$queryRaw.mockResolvedValue([despachado]);
      db.envio.updateMany.mockResolvedValue({ count: 0 });

      await servicio.registrarEntregaDelCourier(40, 'OT1');

      expect(db.pedido.update).not.toHaveBeenCalled();
      expect(correos.add).not.toHaveBeenCalled();
    });
  });

  it('pedido inexistente: 404', async () => {
    db.$queryRaw.mockResolvedValue([]);

    await expect(
      servicio.cambiar(PERSONAL, CODIGO, { estado: 'en_preparacion' }),
    ).rejects.toThrow(new NotFoundException('El pedido no existe.'));
  });

  it('RNF-32 · con Redis caído el cambio queda guardado y la petición no falla', async () => {
    pedidoEn('despachado');
    correos.add.mockRejectedValue(new Error('ECONNREFUSED'));

    const respuesta = await servicio.cambiar(PERSONAL, CODIGO, {
      estado: 'entregado',
    });

    expect(respuesta.estado).toBe('entregado');
    expect(db.notificacion.create).toHaveBeenCalledTimes(1);
  });

  it('RNF-12 · si falla el guardado de la notificación, no se encola ningún correo', async () => {
    pedidoEn('despachado');
    db.notificacion.create.mockRejectedValue(new Error('falló la base'));

    await expect(
      servicio.cambiar(PERSONAL, CODIGO, { estado: 'entregado' }),
    ).rejects.toThrow('falló la base');
    expect(correos.add).not.toHaveBeenCalled();
  });
});
