import { validarEntorno } from './entorno.js';

const BASE = {
  DATABASE_URL: 'postgresql://cp:cp@localhost:5432/cp',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validarEntorno · Chilexpress', () => {
  it('E7-H2 · en producción con clave exige la URL: no cobra tarifas de sandbox por olvido', () => {
    expect(() =>
      validarEntorno({
        ...BASE,
        NODE_ENV: 'production',
        CHILEXPRESS_CLAVE_COTIZACION: 'clave',
      }),
    ).toThrow('CHILEXPRESS_URL_BASE');
  });

  it('E7-H3 · en producción, la clave de envíos también exige la URL', () => {
    expect(() =>
      validarEntorno({
        ...BASE,
        NODE_ENV: 'production',
        CHILEXPRESS_CLAVE_ENVIOS: 'clave',
      }),
    ).toThrow('CHILEXPRESS_URL_BASE');
  });

  it('E7-H3 · el RUT de la empresa va sin puntos ni dígito verificador', () => {
    expect(
      validarEntorno({ ...BASE, CHILEXPRESS_RUT_EMPRESA: '77398220' })
        .CHILEXPRESS_RUT_EMPRESA,
    ).toBe(77398220);
    expect(() =>
      validarEntorno({ ...BASE, CHILEXPRESS_RUT_EMPRESA: '77.398.220-1' }),
    ).toThrow('CHILEXPRESS_RUT_EMPRESA');
  });

  it('E7-H2 · en producción arranca con clave y URL, o sin clave', () => {
    expect(
      validarEntorno({
        ...BASE,
        NODE_ENV: 'production',
        CHILEXPRESS_CLAVE_COTIZACION: 'clave',
        CHILEXPRESS_URL_BASE: 'https://services.wschilexpress.com/',
      }).CHILEXPRESS_URL_BASE,
    ).toBe('https://services.wschilexpress.com');
    expect(() =>
      validarEntorno({ ...BASE, NODE_ENV: 'production' }),
    ).not.toThrow();
  });

  it('E7-H2 · en desarrollo la URL es opcional', () => {
    expect(() =>
      validarEntorno({
        ...BASE,
        NODE_ENV: 'development',
        CHILEXPRESS_CLAVE_COTIZACION: 'clave',
      }),
    ).not.toThrow();
  });
});
