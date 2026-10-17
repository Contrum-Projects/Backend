import type { Redis } from 'ioredis';
import { IntentosSesion } from './intentos-sesion.js';

describe('IntentosSesion', () => {
  let redis: { eval: ReturnType<typeof vi.fn> };
  let intentos: IntentosSesion;

  beforeEach(() => {
    redis = { eval: vi.fn().mockResolvedValue(0) };
    intentos = new IntentosSesion(redis as unknown as Redis);
  });

  it('E1-H2 · límite de intentos: bajo el máximo reserva el intento y no bloquea', async () => {
    expect(await intentos.reservar('a@b.cl', '1.2.3.4')).toBe(0);
  });

  it('E1-H2 · límite de intentos: reserva en un solo paso con 5 por correo, 20 por IP y ventana de 15 min', async () => {
    await intentos.reservar('a@b.cl', '1.2.3.4');

    const [script, cantidad, claveCorreo, claveIp, ventana, porCorreo, porIp] =
      redis.eval.mock.calls[0];
    // Consulta e INCR en el mismo script: intentos simultáneos no pasan el límite
    expect(script).toContain('INCR');
    expect(script).toContain('GET');
    expect(cantidad).toBe(2);
    expect(claveCorreo).toMatch(
      /^limite:inicio-sesion:1\.2\.3\.4:[0-9a-f]{64}$/,
    );
    expect(claveCorreo).not.toContain('a@b.cl');
    expect(claveIp).toBe('limite:inicio-sesion:1.2.3.4');
    expect([ventana, porCorreo, porIp]).toEqual([900_000, 5, 20]);
  });

  it('E1-H2 · límite de intentos: bloqueado informa los segundos que faltan', async () => {
    redis.eval.mockResolvedValue(299_500);
    expect(await intentos.reservar('a@b.cl', '1.2.3.4')).toBe(300);
  });

  it('E1-H2 · inicio correcto: reinicia el contador del correo y devuelve el intento a la IP', async () => {
    await intentos.confirmarExito('a@b.cl', '1.2.3.4');
    const [script, , claveCorreo, claveIp, borrar] = redis.eval.mock.calls[0];
    expect(script).toContain('DEL');
    expect(claveCorreo).toMatch(/^limite:inicio-sesion:1\.2\.3\.4:/);
    expect(claveIp).toBe('limite:inicio-sesion:1.2.3.4');
    expect(borrar).toBe('1');
  });

  it('E1-H2 · contraseña correcta con cuenta que no puede entrar: descuenta el intento', async () => {
    await intentos.descontar('a@b.cl', '1.2.3.4');
    expect(redis.eval.mock.calls[0][4]).toBe('0');
  });

  it('si Redis no responde, no bloquea ni falla (RNF-32)', async () => {
    redis.eval.mockRejectedValue(new Error('Redis caído'));
    expect(await intentos.reservar('a@b.cl', '1.2.3.4')).toBe(0);
    await expect(
      intentos.confirmarExito('a@b.cl', '1.2.3.4'),
    ).resolves.toBeUndefined();
    await expect(
      intentos.descontar('a@b.cl', '1.2.3.4'),
    ).resolves.toBeUndefined();
  });
});
