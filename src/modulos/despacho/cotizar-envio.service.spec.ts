import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { ROLES } from '../../common/dominio/roles.js';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CarritoService } from '../carrito/carrito.service.js';
import { COTIZACION_NO_DISPONIBLE } from './cotizador-chilexpress.js';
import type { CotizadorEnvio } from './cotizador-envio.js';
import {
  ARTICULO_NO_VENDIBLE,
  CotizarEnvioService,
  SIN_COBERTURA,
} from './cotizar-envio.service.js';

const CUENTA = '3f0c2a52-0b9e-4c55-9d0e-6a3a4f6d1b2c';
const BULTO = { pesoGramos: 320, altoCm: 18, anchoCm: 6, largoCm: 6 };
const MEDIDAS = { pesoGramos: 320, altoCm: '18', anchoCm: '6', largoCm: '6' };

describe('CotizarEnvioService', () => {
  const crear = () => {
    const db = {
      usuario: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 7 }) },
      direccion: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ comuna: { codigoCut: '13101' } }),
      },
      bodega: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ comuna: { codigoCut: '08101' } }),
      },
      carrito: {
        findUnique: vi.fn().mockResolvedValue({
          items: [
            {
              cantidad: 1,
              articulo: { formato: MEDIDAS, pack: null },
            },
          ],
        }),
      },
    };
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
    };
    const cotizador = {
      cotizar: vi.fn().mockResolvedValue({ servicio: 'EXPRESS', tarifa: 7310 }),
    };
    const carrito = {
      obtener: vi.fn().mockResolvedValue({
        items: [{ aLaVenta: true }],
        total: 1194,
      }),
    };
    const config = { get: vi.fn().mockReturnValue(19) };
    const servicio = new CotizarEnvioService(
      db as unknown as PrismaService,
      config as unknown as ConfigService<Entorno, true>,
      redis as unknown as Redis,
      cotizador as unknown as CotizadorEnvio,
      carrito as unknown as CarritoService,
    );
    return { db, redis, cotizador, carrito, servicio };
  };

  it('E7-H2 · cotización obtenida: suma el costo con IVA al total del carrito y no informa el servicio', async () => {
    const { servicio, carrito, db } = crear();

    const cotizacion = await servicio.cotizarCarrito(CUENTA, ROLES.CLIENTE, {
      direccionId: 12,
    });

    expect(cotizacion).toEqual({
      costo: 7310,
      totalCarrito: 1194,
      total: 8504,
    });
    expect(db.direccion.findFirst.mock.calls[0]![0].where).toEqual({
      id: 12,
      usuarioId: 7,
    });
    expect(carrito.obtener).toHaveBeenCalledWith(CUENTA, ROLES.CLIENTE);
  });

  it('E7-H2 · cotización obtenida: guarda el costo neto, dividiendo la tarifa por el IVA', async () => {
    const { servicio } = crear();

    await expect(servicio.cotizar('13101', BULTO)).resolves.toEqual({
      servicio: 'EXPRESS',
      costoNeto: 6143,
    });
  });

  it('E7-H2 · cotización obtenida: cotiza desde la primera bodega activa de la venta online', async () => {
    const { servicio, db, cotizador } = crear();

    await servicio.cotizar('13101', BULTO);

    expect(db.bodega.findFirst.mock.calls[0]![0]).toMatchObject({
      where: { activa: true, abasteceVentaOnline: true },
      orderBy: { id: 'asc' },
    });
    expect(cotizador.cotizar).toHaveBeenCalledWith({
      origenCut: '08101',
      destinoCut: '13101',
      bulto: BULTO,
    });
  });

  it('E7-H2 · cotización obtenida: un pack se cuenta por sus formatos', async () => {
    const { servicio, db } = crear();
    db.carrito.findUnique.mockResolvedValue({
      items: [
        {
          cantidad: 2,
          articulo: {
            formato: null,
            pack: { componentes: [{ cantidad: 3, formato: MEDIDAS }] },
          },
        },
      ],
    });

    await expect(
      servicio.bultoDelCarrito(db as unknown as PrismaService, 7),
    ).resolves.toEqual({
      pesoGramos: 1920,
      altoCm: 16,
      anchoCm: 16,
      largoCm: 16,
    });
  });

  it('E7-H2 · cotización repetida: la reutiliza 15 minutos sin volver a consultar a Chilexpress', async () => {
    const { servicio, redis, cotizador } = crear();

    await servicio.cotizar('13101', BULTO);
    const [clave, guardado, modo, vigencia] = redis.set.mock.calls[0]!;
    expect(clave).toBe('cache:cotizacion-envio:08101:13101:320:18x6x6');
    expect(JSON.parse(guardado as string)).toEqual({
      servicio: 'EXPRESS',
      tarifa: 7310,
    });
    expect([modo, vigencia]).toEqual(['EX', 900]);

    cotizador.cotizar.mockClear();
    redis.get.mockResolvedValue(guardado);
    await expect(servicio.cotizar('13101', BULTO)).resolves.toMatchObject({
      costoNeto: 6143,
    });
    expect(cotizador.cotizar).not.toHaveBeenCalled();
  });

  it('E7-H2 · cotización repetida: una copia inválida en caché no se usa y vuelve a consultar a Chilexpress', async () => {
    for (const invalida of [
      '{}',
      'no es json',
      '{"servicio":"EXPRESS","tarifa":-1}',
      '{"servicio":"","tarifa":7310}',
    ]) {
      const { servicio, redis, cotizador } = crear();
      redis.get.mockResolvedValue(invalida);

      await expect(servicio.cotizar('13101', BULTO)).resolves.toMatchObject({
        costoNeto: 6143,
      });
      expect(cotizador.cotizar).toHaveBeenCalledOnce();
    }
  });

  it('E7-H2 · Redis caído: consulta directo a Chilexpress y cotiza igual (RNF-32)', async () => {
    const { servicio, redis, cotizador } = crear();
    redis.get.mockRejectedValue(new Error('Redis caído'));
    redis.set.mockRejectedValue(new Error('Redis caído'));

    await expect(servicio.cotizar('13101', BULTO)).resolves.toMatchObject({
      costoNeto: 6143,
    });
    expect(cotizador.cotizar).toHaveBeenCalledOnce();
  });

  it('E7-H2 · comuna sin cobertura: responde 409 y ofrece retiro, sin guardar nada en caché', async () => {
    const { servicio, redis, cotizador } = crear();
    cotizador.cotizar.mockResolvedValue(null);

    const error = await servicio
      .cotizar('13101', BULTO)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(SIN_COBERTURA);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('E7-H2 · servicio de envíos sin respuesta: el 503 del courier llega al cliente', async () => {
    const { servicio, cotizador } = crear();
    cotizador.cotizar.mockRejectedValue(
      new ServiceUnavailableException(COTIZACION_NO_DISPONIBLE),
    );

    await expect(
      servicio.cotizarCarrito(CUENTA, ROLES.CLIENTE, { direccionId: 12 }),
    ).rejects.toThrow(COTIZACION_NO_DISPONIBLE);
  });

  it('E7-H2 · sin bodega para la venta online: responde 503 sin consultar a Chilexpress', async () => {
    const { servicio, db, cotizador } = crear();
    db.bodega.findFirst.mockResolvedValue(null);

    await expect(servicio.cotizar('13101', BULTO)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(cotizador.cotizar).not.toHaveBeenCalled();
  });

  it('E7-H2 · artículo que ya no se vende: responde 409 sin consultar a Chilexpress', async () => {
    const { servicio, carrito, cotizador } = crear();
    carrito.obtener.mockResolvedValue({
      items: [{ aLaVenta: true }, { aLaVenta: false }],
      total: 1194,
    });

    await expect(
      servicio.cotizarCarrito(CUENTA, ROLES.CLIENTE, { direccionId: 12 }),
    ).rejects.toThrow(ARTICULO_NO_VENDIBLE);
    expect(cotizador.cotizar).not.toHaveBeenCalled();
  });

  it('una dirección de otra cuenta responde 404 y un carrito vacío 409', async () => {
    const { servicio, db } = crear();

    db.direccion.findFirst.mockResolvedValueOnce(null);
    await expect(
      servicio.cotizarCarrito(CUENTA, ROLES.CLIENTE, { direccionId: 12 }),
    ).rejects.toBeInstanceOf(NotFoundException);

    db.carrito.findUnique.mockResolvedValue(null);
    await expect(
      servicio.cotizarCarrito(CUENTA, ROLES.CLIENTE, { direccionId: 12 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
