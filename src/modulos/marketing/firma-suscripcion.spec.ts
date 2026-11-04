import type { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';
import { FirmaSuscripcion } from './firma-suscripcion.js';

const firmaDePrueba = (secreto = 's'.repeat(32)) => {
  const config: Record<string, unknown> = {
    JWT_ACCESS_SECRET: secreto,
    CONFIRMACION_CORREO_HORAS: 24,
    URL_TIENDA: 'https://tienda.cl/',
  };
  return new FirmaSuscripcion({
    get: (clave: string) => config[clave],
  } as unknown as ConfigService<Entorno, true>);
};

const tokenDe = (enlace: string): string =>
  new URL(enlace).searchParams.get('token')!;

describe('FirmaSuscripcion', () => {
  const firma = firmaDePrueba();
  const email = 'camila@correo.cl';
  const emitido = new Date('2026-11-03T12:00:00.000Z');
  const antesDeVencer = new Date('2026-11-04T11:59:59.000Z');

  it('E12-H1 · suscripción confirmada: el enlace lleva a la tienda y su token devuelve el correo y la emisión', () => {
    const { enlace, vence } = firma.enlace(email, emitido);

    expect(
      enlace.startsWith('https://tienda.cl/suscripcion/confirmar?token='),
    ).toBe(true);
    expect(vence).toEqual(new Date('2026-11-04T12:00:00.000Z'));
    expect(firma.verificar(tokenDe(enlace), antesDeVencer)).toEqual({
      email,
      emitido,
    });
  });

  it('E12-H1 · suscripción confirmada: el enlace vence a las 24 horas', () => {
    const token = tokenDe(firma.enlace(email, emitido).enlace);

    expect(
      firma.verificar(token, new Date('2026-11-04T12:00:00.000Z')),
    ).toBeNull();
  });

  it('E12-H1 · suscripción confirmada: rechaza un token alterado, de otro secreto o con otro formato (RNF-08)', () => {
    const token = firma.firmar(
      email,
      emitido,
      new Date('2026-11-04T12:00:00Z'),
    );
    const [emision, vence, correo, sello] = token.split('.');
    const otroCorreo = Buffer.from('otra@correo.cl').toString('base64url');
    const alargado = `${emision}.${Number(vence) + 86_400_000}.${correo}.${sello}`;

    expect(
      firma.verificar(
        `${emision}.${vence}.${otroCorreo}.${sello}`,
        antesDeVencer,
      ),
    ).toBeNull();
    expect(firma.verificar(alargado, antesDeVencer)).toBeNull();
    expect(
      firmaDePrueba('o'.repeat(32)).verificar(token, antesDeVencer),
    ).toBeNull();
    expect(firma.verificar('no-es-un-token', antesDeVencer)).toBeNull();
    expect(firma.verificar(`${token}x`, antesDeVencer)).toBeNull();
  });
});
