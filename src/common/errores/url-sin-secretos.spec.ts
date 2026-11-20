import { peticionParaElLog, urlSinSecretos } from './url-sin-secretos.js';

describe('urlSinSecretos', () => {
  it('SCRUM-168 · oculta el token de la query de los enlaces de los correos', () => {
    expect(urlSinSecretos('/api/cuentas/confirmar?token=abc123&otro=1')).toBe(
      '/api/cuentas/confirmar?token=[Redacted]&otro=1',
    );
    expect(urlSinSecretos('/api/x?a=1&TOKEN=abc')).toBe(
      '/api/x?a=1&TOKEN=[Redacted]',
    );
  });

  it('SCRUM-168 · oculta el token del seguimiento de la publicidad, que va en el camino', () => {
    expect(
      urlSinSecretos(
        '/api/marketing/seguimiento/clic/eyJhbGciOi.firma?destino=%2Fofertas',
      ),
    ).toBe('/api/marketing/seguimiento/clic/[Redacted]?destino=%2Fofertas');
    expect(urlSinSecretos('/api/marketing/seguimiento/apertura/abc')).toBe(
      '/api/marketing/seguimiento/apertura/[Redacted]',
    );
  });

  it('SCRUM-168 · deja igual una URL sin tokens', () => {
    expect(urlSinSecretos('/api/clientes?pagina=2')).toBe(
      '/api/clientes?pagina=2',
    );
  });
});

describe('peticionParaElLog', () => {
  it('SCRUM-168 · la petición del log no trae el token ni los params', () => {
    const peticion = {
      method: 'GET',
      url: '/api/marketing/seguimiento/apertura/abc',
      params: { splat: ['marketing', 'seguimiento', 'apertura', 'abc'] },
    };

    expect(peticionParaElLog(peticion)).toEqual({
      method: 'GET',
      url: '/api/marketing/seguimiento/apertura/[Redacted]',
    });
  });
});
