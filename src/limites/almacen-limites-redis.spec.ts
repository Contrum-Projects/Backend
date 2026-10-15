import type { Redis } from 'ioredis';
import { AlmacenLimitesRedis } from './almacen-limites-redis.js';

describe('AlmacenLimitesRedis', () => {
  const crear = (evalMock: ReturnType<typeof vi.fn>) =>
    new AlmacenLimitesRedis({ eval: evalMock } as unknown as Redis);

  it('dentro del límite: no bloquea e informa el tiempo en segundos', async () => {
    const evalMock = vi.fn().mockResolvedValue([3, 41_500, -2]);
    const registro = await crear(evalMock).increment(
      'ip',
      60_000,
      5,
      0,
      'default',
    );

    expect(registro).toEqual({
      totalHits: 3,
      timeToExpire: 42,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    // Contador y bloqueo con prefijo; sin duración de bloqueo usa la ventana
    expect(evalMock.mock.calls[0].slice(1)).toEqual([
      2,
      'limite:default:ip',
      'limite:default:ip:bloqueo',
      60_000,
      5,
      60_000,
    ]);
  });

  it('sobre el límite: queda bloqueado mientras dure el bloqueo', async () => {
    const evalMock = vi.fn().mockResolvedValue([6, 30_000, 60_000]);
    const registro = await crear(evalMock).increment(
      'ip',
      60_000,
      5,
      60_000,
      'default',
    );
    expect(registro.isBlocked).toBe(true);
    expect(registro.timeToBlockExpire).toBe(60);
  });

  it('si Redis no responde, deja pasar la petición (RNF-32)', async () => {
    const evalMock = vi.fn().mockRejectedValue(new Error('Redis caído'));
    const registro = await crear(evalMock).increment(
      'ip',
      60_000,
      5,
      0,
      'default',
    );
    expect(registro.isBlocked).toBe(false);
  });
});
