import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  crearSeguimiento,
  SeguimientoChilexpress,
} from './seguimiento-chilexpress.js';
import {
  SEGUIMIENTO_NO_DISPONIBLE,
  SeguimientoNoConfigurado,
} from './seguimiento-envio.js';

const CLAVE = 'clave-de-prueba';
const CONSULTA = {
  codigoSeguimiento: '99726299584',
  referencia: 'AB12CD34EF56',
};

const evento = (eventCode: string, eventDateTime: string) => ({
  eventDateTime,
  description: 'DESCRIPCION',
  code: { eventCode },
});

describe('SeguimientoChilexpress', () => {
  const llamada = vi.fn<typeof fetch>();
  const seguimiento = new SeguimientoChilexpress(
    CLAVE,
    'https://sandbox.test',
    77398220,
  );

  const respuesta = (cuerpo: unknown, status = 200) =>
    llamada.mockResolvedValue(new Response(JSON.stringify(cuerpo), { status }));

  const conEventos = (...eventos: unknown[]) =>
    respuesta({
      data: { trackingEvents: eventos },
      statusCode: 0,
      statusDescription: 'Extraccion exitosa',
      errors: null,
    });

  const noDisponible = () =>
    expect(seguimiento.consultar(CONSULTA)).rejects.toThrow(
      new ServiceUnavailableException(SEGUIMIENTO_NO_DISPONIBLE),
    );

  beforeEach(() => {
    llamada.mockReset();
    vi.stubGlobal('fetch', llamada);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('E7-H3 · estado actualizado: consulta la OT con la clave, el RUT, la referencia y los eventos', async () => {
    conEventos(evento('13', '2026-11-01T09:05:00Z'));

    await seguimiento.consultar(CONSULTA);

    const [url, opciones] = llamada.mock.calls[0];
    expect(url).toBe('https://sandbox.test/transport-orders/api/v1.0/tracking');
    expect(opciones?.method).toBe('POST');
    expect(opciones?.headers).toMatchObject({
      'Ocp-Apim-Subscription-Key': CLAVE,
    });
    expect(JSON.parse(opciones?.body as string)).toEqual({
      reference: 'AB12CD34EF56',
      transportOrderNumber: 99726299584,
      rut: 77398220,
      showTrackingEvents: 1,
    });
  });

  it.each([
    ['4', 'en_transito'],
    ['11', 'en_transito'],
    ['13', 'en_reparto'],
    ['14', 'entregado'],
  ])(
    'E7-H3 · estado actualizado: el evento %s se traduce a %s',
    async (codigo, estado) => {
      conEventos(evento(codigo, '2026-11-01T09:05:00Z'));

      expect(await seguimiento.consultar(CONSULTA)).toBe(estado);
    },
  );

  it('toma el evento más reciente, sin importar el orden de la lista', async () => {
    conEventos(
      evento('4', '2026-10-26T18:42:00Z'),
      evento('14', '2026-10-29T16:06:00Z'),
      evento('13', '2026-10-29T09:05:00Z'),
    );

    expect(await seguimiento.consultar(CONSULTA)).toBe('entregado');
  });

  it('un evento sin traducir posterior a la entrega no impide registrarla', async () => {
    conEventos(
      evento('14', '2026-10-29T16:06:00Z'),
      evento('99', '2026-10-30T10:00:00Z'),
    );

    expect(await seguimiento.consultar(CONSULTA)).toBe('entregado');
  });

  it.each([
    ['sin eventos', []],
    ['solo códigos sin traducir', [evento('99', '2026-10-30T10:00:00Z')]],
    ['sin fecha válida', [evento('14', 'no es fecha')]],
    [
      'un código heredado de Object',
      [evento('constructor', '2026-10-30T10:00:00Z')],
    ],
  ])('%s: no informa un estado', async (_caso, eventos) => {
    conEventos(...eventos);

    expect(await seguimiento.consultar(CONSULTA)).toBeNull();
  });

  it('E7-H3 · la OT no está disponible (-41): no informa un estado y no corta la pasada', async () => {
    respuesta(
      {
        data: null,
        statusCode: -41,
        statusDescription: 'La OT no se encuentra disponible para consultar',
        errors: null,
      },
      400,
    );

    expect(await seguimiento.consultar(CONSULTA)).toBeNull();
  });

  it('un código fuera del rango seguro de un número JSON no se consulta', async () => {
    expect(
      await seguimiento.consultar({
        ...CONSULTA,
        codigoSeguimiento: '99999999999999999999',
      }),
    ).toBeNull();
    expect(llamada).not.toHaveBeenCalled();
  });

  it('RNF-32 · Chilexpress no responde, falla o rechaza la clave: 503, y se corta la pasada', async () => {
    respuesta({ milliseconds: 0, statusCode: 0, errors: ['falla'] }, 500);
    await noDisponible();

    for (const status of [401, 403, 429]) {
      respuesta({ statusCode: status }, status);
      await noDisponible();
    }

    llamada.mockRejectedValue(new Error('timeout'));
    await noDisponible();
  });

  it('E7-H3 · una OT rechazada o una respuesta ilegible no frena a los demás envíos', async () => {
    respuesta({ data: null, statusCode: -1 }, 400);
    expect(await seguimiento.consultar(CONSULTA)).toBeNull();

    respuesta({ data: null, statusCode: -5 });
    expect(await seguimiento.consultar(CONSULTA)).toBeNull();

    llamada.mockResolvedValue(new Response('no es json'));
    expect(await seguimiento.consultar(CONSULTA)).toBeNull();
  });

  it('RNF-10 · los logs no incluyen la clave ni el cuerpo de la respuesta', async () => {
    const error = vi.spyOn(Logger.prototype, 'error');
    const aviso = vi.spyOn(Logger.prototype, 'warn');

    llamada.mockRejectedValue(new TypeError(`valor inválido: ${CLAVE}`));
    await noDisponible();
    llamada.mockResolvedValue(new Response('Juan Pérez, Calle 123'));
    await seguimiento.consultar(CONSULTA);

    const registrado = [...error.mock.calls, ...aviso.mock.calls].join(' ');
    expect(registrado).not.toContain(CLAVE);
    expect(registrado).not.toContain('Juan');
  });
});

describe('crearSeguimiento', () => {
  it('E7-H3 · con clave y RUT consulta Chilexpress', () => {
    expect(
      crearSeguimiento('clave', 77398220, 'https://sandbox.test'),
    ).toBeInstanceOf(SeguimientoChilexpress);
  });

  it('E7-H3 · sin clave o sin RUT, los envíos conservan su último estado', async () => {
    for (const [clave, rut] of [
      [undefined, 77398220],
      ['clave', undefined],
    ] as const) {
      const seguimiento = crearSeguimiento(clave, rut, 'https://sandbox.test');
      expect(seguimiento).toBeInstanceOf(SeguimientoNoConfigurado);
      await expect(seguimiento.consultar(CONSULTA)).rejects.toThrow(
        new ServiceUnavailableException(SEGUIMIENTO_NO_DISPONIBLE),
      );
    }
  });
});
