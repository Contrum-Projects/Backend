import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CambiarEstadoPedidoService } from '../pedidos/cambiar-estado-pedido.service.js';
import { ActualizarEnviosService } from './actualizar-envios.service.js';
import type { SeguimientoEnvio } from './seguimiento-envio.js';

const envio = (id: number, estadoEnvio = 'en_transito') => ({
  id,
  pedidoId: id + 100,
  codigoSeguimiento: `OT${id}`,
  estadoEnvio,
  pedido: { codigoPublico: `PEDIDO${id}` },
});

describe('ActualizarEnviosService', () => {
  let db: {
    envio: {
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
  let seguimiento: { consultar: ReturnType<typeof vi.fn> };
  let cambioEstado: { registrarEntregaDelCourier: ReturnType<typeof vi.fn> };
  let servicio: ActualizarEnviosService;

  beforeEach(() => {
    db = {
      envio: {
        findMany: vi.fn().mockResolvedValue([envio(1)]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    seguimiento = { consultar: vi.fn().mockResolvedValue('en_reparto') };
    cambioEstado = {
      registrarEntregaDelCourier: vi.fn().mockResolvedValue(undefined),
    };
    servicio = new ActualizarEnviosService(
      db as unknown as PrismaService,
      seguimiento as unknown as SeguimientoEnvio,
      cambioEstado as unknown as CambiarEstadoPedidoService,
    );
  });

  it('E7-H3 · estado actualizado: guarda el nuevo estado que informa el courier', async () => {
    await servicio.actualizar();

    expect(seguimiento.consultar).toHaveBeenCalledWith({
      codigoSeguimiento: 'OT1',
      referencia: 'PEDIDO1',
    });
    expect(db.envio.updateMany).toHaveBeenCalledWith({
      where: {
        id: 1,
        codigoSeguimiento: 'OT1',
        pedido: { estadoActual: 'despachado' },
      },
      data: { estadoEnvio: 'en_reparto' },
    });
    expect(cambioEstado.registrarEntregaDelCourier).not.toHaveBeenCalled();
  });

  it('E7-H3 · solo consulta pedidos despachados con código que nunca estuvieron entregados', async () => {
    await servicio.actualizar();

    expect(db.envio.findMany.mock.calls[0][0].where).toEqual({
      id: { gt: 0 },
      codigoSeguimiento: { not: null },
      pedido: {
        estadoActual: 'despachado',
        historial: { none: { estado: 'entregado' } },
      },
    });
  });

  it('E7-H3 · el courier informa la entrega: registra la entrega del pedido', async () => {
    seguimiento.consultar.mockResolvedValue('entregado');

    await servicio.actualizar();

    expect(cambioEstado.registrarEntregaDelCourier).toHaveBeenCalledWith(
      101,
      'OT1',
    );
    expect(db.envio.updateMany).not.toHaveBeenCalled();
  });

  it('el mismo estado de antes o uno sin traducción no escribe nada', async () => {
    seguimiento.consultar.mockResolvedValue('en_transito');
    await servicio.actualizar();

    seguimiento.consultar.mockResolvedValue(null);
    await servicio.actualizar();

    expect(db.envio.updateMany).not.toHaveBeenCalled();
    expect(cambioEstado.registrarEntregaDelCourier).not.toHaveBeenCalled();
  });

  it('RNF-32 · el courier no responde: corta la pasada y conserva el último estado', async () => {
    db.envio.findMany.mockResolvedValue([envio(1), envio(2)]);
    seguimiento.consultar.mockRejectedValue(
      new ServiceUnavailableException('sin respuesta'),
    );

    await expect(servicio.actualizar()).resolves.toBeUndefined();

    expect(seguimiento.consultar).toHaveBeenCalledTimes(1);
    expect(db.envio.updateMany).not.toHaveBeenCalled();
  });

  it('otra falla solo afecta a su envío: sigue con los demás', async () => {
    db.envio.findMany.mockResolvedValue([envio(1), envio(2)]);
    seguimiento.consultar
      .mockRejectedValueOnce(new Error('dato raro'))
      .mockResolvedValueOnce('en_reparto');

    await servicio.actualizar();

    expect(db.envio.updateMany).toHaveBeenCalledTimes(1);
    expect(db.envio.updateMany.mock.calls[0][0].where.id).toBe(2);
  });

  it('recorre todos los lotes, no solo los primeros 100 envíos', async () => {
    const primerLote = Array.from({ length: 100 }, (_, i) => envio(i + 1));
    db.envio.findMany
      .mockResolvedValueOnce(primerLote)
      .mockResolvedValueOnce([envio(101)]);

    await servicio.actualizar();

    expect(db.envio.findMany).toHaveBeenCalledTimes(2);
    expect(db.envio.findMany.mock.calls[1][0].where.id).toEqual({ gt: 100 });
    expect(seguimiento.consultar).toHaveBeenCalledTimes(101);
  });
});
