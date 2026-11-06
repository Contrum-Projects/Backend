import type { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';
import { FirmaSeguimiento, MAXIMO_DESTINO } from './firma-seguimiento.js';

const configDePrueba = (
  /** `null`: sin URL_API. */
  urlApi: string | null = 'https://api.tienda.cl',
  secreto = 's'.repeat(32),
) => {
  const config: Record<string, unknown> = {
    JWT_ACCESS_SECRET: secreto,
    URL_API: urlApi ?? undefined,
  };
  return {
    get: (clave: string) => config[clave],
  } as unknown as ConfigService<Entorno, true>;
};

const DESTINO = 'https://tienda.cl/carrito';

/** El token es el último tramo de la ruta, antes de la consulta. */
const tokenDe = (enlace: string): string =>
  new URL(enlace).pathname.split('/').at(-1)!;

describe('FirmaSeguimiento', () => {
  const firma = new FirmaSeguimiento(configDePrueba());

  it('E12-H6 · CA1 apertura: la imagen apunta a la API y su token devuelve la notificación', () => {
    const enlace = firma.enlaceApertura(9)!;

    expect(
      enlace.startsWith(
        'https://api.tienda.cl/api/marketing/seguimiento/apertura/',
      ),
    ).toBe(true);
    expect(firma.verificarApertura(tokenDe(enlace))).toBe(9);
  });

  it('E12-H6 · CA1 clic: el enlace lleva su destino y el token vale solo con ese destino', () => {
    const enlace = firma.enlaceClic(9, DESTINO);
    const url = new URL(enlace);

    expect(url.pathname.startsWith('/api/marketing/seguimiento/clic/')).toBe(
      true,
    );
    expect(url.searchParams.get('destino')).toBe(DESTINO);
    expect(firma.verificarClic(tokenDe(enlace), DESTINO)).toBe(9);
    expect(
      firma.verificarClic(tokenDe(enlace), 'https://tienda.cl/otra'),
    ).toBeNull();
  });

  it('E12-H6 · un token de apertura no vale como clic, ni uno de clic como apertura', () => {
    const apertura = tokenDe(firma.enlaceApertura(9)!);
    const clic = tokenDe(firma.enlaceClic(9, DESTINO));

    expect(firma.verificarClic(apertura, DESTINO)).toBeNull();
    expect(firma.verificarApertura(clic)).toBeNull();
  });

  it('E12-H6 · firma alterada, de otra notificación, con otro secreto o mal formada: no vale', () => {
    const token = tokenDe(firma.enlaceApertura(9)!);
    const [, sello] = token.split('.');
    const otra = new FirmaSeguimiento(
      configDePrueba('https://api.tienda.cl', 'x'.repeat(32)),
    );

    expect(firma.verificarApertura(`10.${sello}`)).toBeNull();
    expect(otra.verificarApertura(token)).toBeNull();
    expect(firma.verificarApertura(`${token}x`)).toBeNull();
    expect(firma.verificarApertura('0.abc')).toBeNull();
    expect(firma.verificarApertura('')).toBeNull();
  });

  it('E12-H6 · no vence: un correo abierto años después también cuenta', () => {
    vi.useFakeTimers();
    try {
      const token = tokenDe(firma.enlaceApertura(9)!);
      vi.setSystemTime(new Date('2036-01-01T00:00:00Z'));

      expect(firma.verificarApertura(token)).toBe(9);
    } finally {
      vi.useRealTimers();
    }
  });

  it('E12-H6 · sin URL_API: no hay imagen y los enlaces van directo a su destino', () => {
    const sinApi = new FirmaSeguimiento(configDePrueba(null));

    expect(sinApi.enlaceApertura(9)).toBeNull();
    expect(sinApi.enlaceClic(9, DESTINO)).toBe(DESTINO);
  });

  it('E12-H6 · un destino demasiado largo no pasa por el seguimiento', () => {
    const largo = `${DESTINO}?${'a'.repeat(MAXIMO_DESTINO)}`;

    expect(firma.enlaceClic(9, largo)).toBe(largo);
  });
});
