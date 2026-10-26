import type { Redis } from 'ioredis';
import { SolicitudesRecuperacion } from './solicitudes-recuperacion.js';

describe('SolicitudesRecuperacion', () => {
  let redis: { eval: ReturnType<typeof vi.fn> };
  let solicitudes: SolicitudesRecuperacion;

  beforeEach(() => {
    redis = { eval: vi.fn().mockResolvedValue(1) };
    solicitudes = new SolicitudesRecuperacion(redis as unknown as Redis);
  });

  it('E1-H4 · límite por correo: cuenta en un solo paso, con ventana de 1 h y el correo como hash', async () => {
    await solicitudes.reservar('a@b.cl');

    const [script, cantidad, clave, ventana] = redis.eval.mock.calls[0];
    expect(script).toContain('INCR');
    expect(script).toContain('PEXPIRE');
    expect(cantidad).toBe(1);
    expect(clave).toMatch(/^limite:recuperacion-contrasena:[0-9a-f]{64}$/);
    expect(clave).not.toContain('a@b.cl');
    expect(ventana).toBe(3_600_000);
  });

  it('E1-H4 · límite por correo: hasta 3 solicitudes por hora pasan, la cuarta no', async () => {
    for (const total of [1, 2, 3]) {
      redis.eval.mockResolvedValueOnce(total);
      expect(await solicitudes.reservar('a@b.cl')).toBe(true);
    }
    redis.eval.mockResolvedValueOnce(4);
    expect(await solicitudes.reservar('a@b.cl')).toBe(false);
  });

  it('si Redis no responde, no frena la solicitud ni falla (RNF-32)', async () => {
    redis.eval.mockRejectedValue(new Error('Redis caído'));
    expect(await solicitudes.reservar('a@b.cl')).toBe(true);
  });
});
