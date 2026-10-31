import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  CambiarEstadoPedidoService,
  COMENTARIO_AL_RETROCEDER,
  estadoNoPermitido,
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
      create: vi.fn().mockResolvedValue({}),
    },
    pedido: { update: vi.fn().mockResolvedValue({}) },
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

    await servicio.cambiar(PERSONAL, CODIGO, { estado: 'despachado' });

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
