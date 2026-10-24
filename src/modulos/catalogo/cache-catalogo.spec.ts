import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Entorno } from '../../config/entorno.js';
import { CacheCatalogo, CLAVES_CACHE } from './cache-catalogo.js';

const crearRedis = () => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
});

const config = {
  get: vi.fn().mockReturnValue(300),
} as unknown as ConfigService<Entorno, true>;

describe('CacheCatalogo', () => {
  let redis: ReturnType<typeof crearRedis>;
  let cache: CacheCatalogo;
  const cargar = vi.fn();

  beforeEach(() => {
    redis = crearRedis();
    cache = new CacheCatalogo(redis as unknown as Redis, config);
    cargar.mockReset().mockResolvedValue([{ id: 1, nombre: 'Kerastase' }]);
  });

  it('E2-H1 · copia en caché: la devuelve sin ir a la base', async () => {
    redis.get.mockResolvedValue(JSON.stringify([{ id: 9, nombre: 'Loreal' }]));

    const marcas = await cache.obtener(CLAVES_CACHE.MARCAS, cargar);

    expect(marcas).toEqual([{ id: 9, nombre: 'Loreal' }]);
    expect(cargar).not.toHaveBeenCalled();
  });

  it('E2-H1 · sin copia: carga de la base y la guarda con su vigencia', async () => {
    const marcas = await cache.obtener(CLAVES_CACHE.MARCAS, cargar);

    expect(marcas).toEqual([{ id: 1, nombre: 'Kerastase' }]);
    expect(redis.set).toHaveBeenCalledWith(
      CLAVES_CACHE.MARCAS,
      JSON.stringify([{ id: 1, nombre: 'Kerastase' }]),
      'EX',
      300,
    );
  });

  it('E2-H1 · Redis no responde: igual devuelve los datos de la base (RNF-32)', async () => {
    redis.get.mockRejectedValue(new Error('Connection is closed.'));
    redis.set.mockRejectedValue(new Error('Connection is closed.'));

    const marcas = await cache.obtener(CLAVES_CACHE.MARCAS, cargar);

    expect(marcas).toEqual([{ id: 1, nombre: 'Kerastase' }]);
  });

  it('E2-H1 · invalidar: borra las claves y no falla si Redis no responde', async () => {
    await cache.invalidar(CLAVES_CACHE.CATEGORIAS);
    expect(redis.del).toHaveBeenCalledWith(CLAVES_CACHE.CATEGORIAS);

    redis.del.mockRejectedValue(new Error('Connection is closed.'));
    await expect(
      cache.invalidar(CLAVES_CACHE.CATEGORIAS),
    ).resolves.toBeUndefined();
  });
});
