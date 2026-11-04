import type { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';
import { FirmaBaja } from './firma-baja.js';
import { FirmaSuscripcion } from './firma-suscripcion.js';

const configDePrueba = (secreto = 's'.repeat(32)) => {
  const config: Record<string, unknown> = {
    JWT_ACCESS_SECRET: secreto,
    CONFIRMACION_CORREO_HORAS: 24,
    URL_TIENDA: 'https://tienda.cl/',
  };
  return {
    get: (clave: string) => config[clave],
  } as unknown as ConfigService<Entorno, true>;
};

const tokenDe = (enlace: string): string =>
  new URL(enlace).searchParams.get('token')!;

describe('FirmaBaja', () => {
  const firma = new FirmaBaja(configDePrueba());
  const email = 'camila@correo.cl';

  it('E12-H2 · baja desde un correo: el enlace lleva a la tienda y su token devuelve la dirección', () => {
    const enlace = firma.enlace(email);

    expect(enlace.startsWith('https://tienda.cl/suscripcion/baja?token=')).toBe(
      true,
    );
    expect(firma.verificar(tokenDe(enlace))).toBe(email);
  });

  it('E12-H2 · baja desde un correo: el enlace no vence (decisión del 4 nov)', () => {
    vi.useFakeTimers();
    try {
      const token = firma.firmar(email);
      vi.setSystemTime(new Date('2036-01-01T00:00:00Z'));

      expect(firma.verificar(token)).toBe(email);
    } finally {
      vi.useRealTimers();
    }
  });

  it('E12-H2 · baja desde un correo: rechaza un token alterado, de otro secreto o con otro formato (RNF-08)', () => {
    const [, sello] = firma.firmar(email).split('.');
    const otroCorreo = Buffer.from('otra@correo.cl').toString('base64url');
    const deOtroSecreto = new FirmaBaja(configDePrueba('o'.repeat(32)));

    expect(firma.verificar(`${otroCorreo}.${sello}`)).toBeNull();
    expect(firma.verificar(deOtroSecreto.firmar(email))).toBeNull();
    expect(firma.verificar('no-es-un-token')).toBeNull();
    expect(firma.verificar(`${firma.firmar(email)}x`)).toBeNull();
  });

  it('E12-H2 · baja desde un correo: un token de confirmación de suscripción no sirve para dar de baja', () => {
    const suscripcion = new FirmaSuscripcion(configDePrueba());
    const token = suscripcion.firmar(
      email,
      new Date(),
      new Date(Date.now() + 60_000),
    );
    const [, , correo, sello] = token.split('.');

    expect(firma.verificar(token)).toBeNull();
    expect(firma.verificar(`${correo}.${sello}`)).toBeNull();
  });
});
