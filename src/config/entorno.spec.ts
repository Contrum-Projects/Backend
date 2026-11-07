import { validarEntorno } from './entorno.js';

const BASE = {
  DATABASE_URL: 'postgresql://cp:cp@localhost:5432/cp',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

const CORREO = {
  RESEND_API_KEY: 're_clave',
  CORREO_REMITENTE: 'Cabello Perfecto <no-responder@correo.cl>',
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
        ...CORREO,
        NODE_ENV: 'production',
        CHILEXPRESS_CLAVE_COTIZACION: 'clave',
        CHILEXPRESS_URL_BASE: 'https://services.wschilexpress.com/',
      }).CHILEXPRESS_URL_BASE,
    ).toBe('https://services.wschilexpress.com');
    expect(() =>
      validarEntorno({ ...BASE, ...CORREO, NODE_ENV: 'production' }),
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

describe('validarEntorno · correos', () => {
  const PRODUCCION = { ...BASE, NODE_ENV: 'production' };

  it('E1-H6 · en producción exige la clave de Resend: sin ella nadie podría activar su cuenta', () => {
    expect(() => validarEntorno(PRODUCCION)).toThrow('RESEND_API_KEY');
  });

  it('E1-H6 · con la clave de Resend exige el remitente', () => {
    expect(() =>
      validarEntorno({ ...BASE, RESEND_API_KEY: 're_clave' }),
    ).toThrow('CORREO_REMITENTE');
  });

  it('E1-H6 · fuera de producción arranca sin clave, con el worker encendido por defecto', () => {
    const entorno = validarEntorno({ ...BASE, RESEND_API_KEY: '' });

    expect(entorno.RESEND_API_KEY).toBeUndefined();
    expect(entorno.CORREOS_WORKER_ACTIVO).toBe(true);
    expect(
      validarEntorno({ ...BASE, CORREOS_WORKER_ACTIVO: 'false' })
        .CORREOS_WORKER_ACTIVO,
    ).toBe(false);
  });
});

describe('validarEntorno · IA', () => {
  it('E4-H1 · arranca sin clave de Gemini, también en producción: la descripción se escribe a mano', () => {
    const entorno = validarEntorno({
      ...BASE,
      ...CORREO,
      NODE_ENV: 'production',
      GEMINI_API_KEY: '',
    });

    expect(entorno.GEMINI_API_KEY).toBeUndefined();
    expect(entorno.GEMINI_MODELO).toBe('gemini-3.8-flash');
  });

  it('E4-H1 · el modelo de Gemini se puede cambiar por entorno', () => {
    expect(
      validarEntorno({ ...BASE, GEMINI_MODELO: 'gemini-3.8-flash-lite' })
        .GEMINI_MODELO,
    ).toBe('gemini-3.8-flash-lite');
  });
});

describe('validarEntorno · consulta al SII', () => {
  it('E10-H1 · arranca sin clave de Khipu, también en producción: se piden documentos', () => {
    const entorno = validarEntorno({
      ...BASE,
      ...CORREO,
      NODE_ENV: 'production',
      KHIPU_API_KEY: '',
    });

    expect(entorno.KHIPU_API_KEY).toBeUndefined();
    expect(entorno.KHIPU_URL_BASE).toBeUndefined();
    expect(entorno.SII_PROVEEDOR).toBe('khipu');
  });

  it('E10-H1 · la URL de Khipu va con https y sin barra final', () => {
    expect(
      validarEntorno({ ...BASE, KHIPU_URL_BASE: 'https://api.khipu.com/' })
        .KHIPU_URL_BASE,
    ).toBe('https://api.khipu.com');
    expect(() =>
      validarEntorno({ ...BASE, KHIPU_URL_BASE: 'http://api.khipu.com' }),
    ).toThrow('KHIPU_URL_BASE');
  });

  it('E10-H1 · el proveedor simulado sirve en desarrollo y en las pruebas, pero no en producción', () => {
    expect(
      validarEntorno({ ...BASE, SII_PROVEEDOR: 'simulado' }).SII_PROVEEDOR,
    ).toBe('simulado');
    expect(() =>
      validarEntorno({
        ...BASE,
        ...CORREO,
        NODE_ENV: 'production',
        SII_PROVEEDOR: 'simulado',
      }),
    ).toThrow('SII_PROVEEDOR');
    expect(() => validarEntorno({ ...BASE, SII_PROVEEDOR: 'otro' })).toThrow(
      'SII_PROVEEDOR',
    );
  });
});

describe('validarEntorno · seguimiento de correos', () => {
  it('E12-H6 · arranca sin secreto del webhook ni URL de la API, también en producción: sin seguimiento', () => {
    const entorno = validarEntorno({
      ...BASE,
      ...CORREO,
      NODE_ENV: 'production',
      RESEND_WEBHOOK_SECRET: '',
      URL_API: '',
    });

    expect(entorno.RESEND_WEBHOOK_SECRET).toBeUndefined();
    expect(entorno.URL_API).toBeUndefined();
  });

  it('E12-H6 · el secreto del webhook es el whsec_ de Resend y la URL de la API va sin barra final', () => {
    const entorno = validarEntorno({
      ...BASE,
      RESEND_WEBHOOK_SECRET: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
      URL_API: 'https://api.tienda.cl/',
    });

    expect(entorno.URL_API).toBe('https://api.tienda.cl');
    expect(() =>
      validarEntorno({ ...BASE, RESEND_WEBHOOK_SECRET: 'otro-secreto' }),
    ).toThrow('RESEND_WEBHOOK_SECRET');
    expect(() => validarEntorno({ ...BASE, URL_API: 'no es url' })).toThrow(
      'URL_API',
    );
  });
});
