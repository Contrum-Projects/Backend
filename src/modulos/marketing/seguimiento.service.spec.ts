import type { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { FirmaSeguimiento } from './firma-seguimiento.js';
import { SeguimientoService } from './seguimiento.service.js';

const TIENDA = 'https://tienda.cl';
const DESTINO = `${TIENDA}/carrito`;

describe('SeguimientoService', () => {
  const crear = () => {
    const prisma = {
      notificacion: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: vi.fn((operaciones: Promise<unknown>[]) =>
        Promise.all(operaciones),
      ),
    };
    const firma = {
      verificarApertura: vi.fn((token: string) =>
        token === 'valido' ? 9 : null,
      ),
      verificarClic: vi.fn((token: string, destino: string) =>
        token === 'valido' && destino === DESTINO ? 9 : null,
      ),
    };
    const config = {
      get: () => `${TIENDA}/`,
    } as unknown as ConfigService<Entorno, true>;
    return {
      prisma,
      firma,
      servicio: new SeguimientoService(
        prisma as unknown as PrismaService,
        firma as unknown as FirmaSeguimiento,
        config,
      ),
    };
  };

  it('E12-H6 · CA1 apertura: guarda la fecha de la primera apertura, solo si aún no tenía', async () => {
    const { servicio, prisma } = crear();

    await servicio.registrarApertura('valido');

    expect(prisma.notificacion.updateMany).toHaveBeenCalledWith({
      where: { id: 9, fechaApertura: null },
      data: { fechaApertura: expect.any(Date) },
    });
  });

  it('E12-H6 · CA1 apertura: con una firma inválida no guarda nada', async () => {
    const { servicio, prisma } = crear();

    await servicio.registrarApertura('falso');

    expect(prisma.notificacion.updateMany).not.toHaveBeenCalled();
  });

  it('E12-H6 · CA1 clic: guarda la fecha del primer clic (y la de apertura si faltaba) y redirige al destino', async () => {
    const { servicio, prisma } = crear();

    const url = await servicio.registrarClic('valido', DESTINO);

    expect(url).toBe(DESTINO);
    expect(prisma.notificacion.updateMany).toHaveBeenCalledWith({
      where: { id: 9, fechaClic: null },
      data: { fechaClic: expect.any(Date) },
    });
    expect(prisma.notificacion.updateMany).toHaveBeenCalledWith({
      where: { id: 9, fechaApertura: null },
      data: { fechaApertura: expect.any(Date) },
    });
  });

  it('E12-H6 · CA1 clic: con una firma inválida lleva a la portada de la tienda, no al destino, y no guarda nada', async () => {
    const { servicio, prisma } = crear();

    const url = await servicio.registrarClic('falso', DESTINO);

    expect(url).toBe(TIENDA);
    expect(prisma.notificacion.updateMany).not.toHaveBeenCalled();
  });

  it('E12-H6 · CA1 clic: un destino fuera de la tienda lleva a su portada, nunca a otro sitio', async () => {
    const { servicio, prisma } = crear();

    for (const destino of [
      'https://otro.com/carrito',
      'https://tienda.cl.otro.com/carrito',
      '//otro.com',
      'javascript:alert(1)',
      undefined,
      ['https://tienda.cl/carrito'],
    ]) {
      expect(await servicio.registrarClic('valido', destino)).toBe(TIENDA);
    }
    expect(prisma.notificacion.updateMany).not.toHaveBeenCalled();
  });

  it('E12-H6 · base caída: la apertura no falla y el clic redirige igual', async () => {
    const { servicio, prisma } = crear();
    prisma.notificacion.updateMany.mockRejectedValue(new Error('base caída'));

    await expect(servicio.registrarApertura('valido')).resolves.toBeUndefined();
    await expect(servicio.registrarClic('valido', DESTINO)).resolves.toBe(
      DESTINO,
    );
  });
});
