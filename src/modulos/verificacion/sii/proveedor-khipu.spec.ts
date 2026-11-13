import { ProveedorKhipu, ProveedorNoConfigurado } from './proveedor-khipu.js';
import { ConsultaSiiNoDisponible } from './proveedor-situacion-tributaria.js';

const ID_CLIENTE = 'id-de-cobrador';
const SECRETO = 'llave-de-prueba';
const TOKEN = 'eyJ.token.de-prueba';
const UN_ANO = 31_536_000;
const RUT = '11222338-K';

const ACTIVIDAD = {
  Activity: 'ACTIVIDADES DE PELUQUERIA Y OTROS TRATAMIENTOS DE BELLEZA',
  Code: '960200',
  Category: 'Primera',
  AffectsIVA: 'true',
  Date: '2017-07-21',
};

const cuerpoOk = (situacion: unknown = situacionDe([ACTIVIDAD])) => ({
  OperationId: '6baf6c19-e485-463b-ae24-a821b025c8a4',
  Status: 'OK',
  Data: situacion === null ? null : { TaxSituation: situacion },
  AdditionalInformation: null,
  Error: null,
  LifeSpan: null,
});

const situacionDe = (actividades: unknown, rut = RUT) => ({
  RolUnicoTributario: rut,
  Name: 'Khipu.S.A',
  Remark: 'Texto legal',
  Activities: actividades,
});

describe('ProveedorKhipu', () => {
  const llamada = vi.fn<typeof fetch>();
  let proveedor: ProveedorKhipu;
  /** Respuestas de la consulta, en orden; la última se repite. */
  let consultas: (() => Response | Promise<Response>)[];
  /** Respuestas del pedido de token, en orden; la última se repite. */
  let tokens: (() => Response | Promise<Response>)[];

  const json =
    (cuerpo: unknown, status = 200) =>
    () =>
      new Response(JSON.stringify(cuerpo), { status });
  const tokenOk = (valor = TOKEN, expiresIn: unknown = UN_ANO) =>
    json({
      access_token: valor,
      token_type: 'bearer',
      expires_in: expiresIn,
      scope: 'openid',
    });
  const responde = (cuerpo: unknown, status = 200) => {
    consultas = [json(cuerpo, status)];
  };
  const siguiente = (lista: (() => Response | Promise<Response>)[]) =>
    (lista.length > 1 ? lista.shift()! : lista[0]!)();

  const llamadasA = (ruta: string) =>
    llamada.mock.calls.filter(([url]) => String(url).endsWith(ruta));
  const pedidosDeToken = () => llamadasA('/oauth2/token');
  const consultasHechas = () => llamadasA('/tax-situation');
  const bearerDe = (indice: number) =>
    (consultasHechas()[indice]![1]?.headers as Record<string, string>)
      .Authorization;

  beforeEach(() => {
    llamada.mockReset();
    proveedor = new ProveedorKhipu(
      { idCliente: ID_CLIENTE, secreto: SECRETO },
      'https://khipu.test',
      'https://auth.khipu.test',
    );
    tokens = [tokenOk()];
    consultas = [json(cuerpoOk())];
    llamada.mockImplementation(async (url) =>
      String(url).endsWith('/oauth2/token')
        ? siguiente(tokens)
        : siguiente(consultas),
    );
    vi.stubGlobal('fetch', llamada);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('E10-H1 · token: lo pide con client_credentials y el id de cobrador y la llave en Basic', async () => {
    await proveedor.consultar(RUT);

    const [url, opciones] = pedidosDeToken()[0]!;
    expect(url).toBe('https://auth.khipu.test/oauth2/token');
    expect(opciones?.method).toBe('POST');
    expect(opciones?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from(`${ID_CLIENTE}:${SECRETO}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(String(opciones?.body)).toBe('grant_type=client_credentials');
    expect(opciones?.signal).toBeInstanceOf(AbortSignal);
  });

  it('E10-H1 · consulta enviada: POST a la situación tributaria con el JWT en Bearer, sin x-api-key, el RUT con puntos y un plazo', async () => {
    await proveedor.consultar(RUT);

    const [url, opciones] = consultasHechas()[0]!;
    expect(url).toBe('https://khipu.test/v1/cl/services/sii.cl/tax-situation');
    expect(opciones?.method).toBe('POST');
    expect(opciones?.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
    });
    expect(opciones?.headers).not.toHaveProperty('x-api-key');
    expect(opciones?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(opciones?.body as string)).toEqual({
      RequestData: { RolUnicoTributario: '11.222.338-K' },
    });
  });

  it('E10-H1 · token guardado: las consultas siguientes lo reutilizan sin pedir otro', async () => {
    await proveedor.consultar(RUT);
    await proveedor.consultar(RUT);

    expect(pedidosDeToken()).toHaveLength(1);
    expect(consultasHechas()).toHaveLength(2);
    expect(bearerDe(1)).toBe(`Bearer ${TOKEN}`);
  });

  it('E10-H1 · consultas simultáneas sin token comparten un solo pedido de token', async () => {
    await Promise.all([
      proveedor.consultar(RUT),
      proveedor.consultar(RUT),
      proveedor.consultar(RUT),
    ]);

    expect(pedidosDeToken()).toHaveLength(1);
    expect(consultasHechas()).toHaveLength(3);
  });

  it('E10-H1 · el token se renueva un día antes de vencer (dura un año, sin refresh_token)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    tokens = [tokenOk('token-1'), tokenOk('token-2')];

    await proveedor.consultar(RUT);
    vi.setSystemTime(new Date('2027-11-11T12:00:00Z'));
    await proveedor.consultar(RUT);
    vi.setSystemTime(new Date('2027-11-12T12:00:01Z'));
    await proveedor.consultar(RUT);

    expect(pedidosDeToken()).toHaveLength(2);
    expect(bearerDe(1)).toBe('Bearer token-1');
    expect(bearerDe(2)).toBe('Bearer token-2');
  });

  it('E10-H1 · un token sin expires_in sirve solo para esa consulta', async () => {
    tokens = [tokenOk(TOKEN, null)];

    await proveedor.consultar(RUT);
    await proveedor.consultar(RUT);

    expect(pedidosDeToken()).toHaveLength(2);
  });

  it('E10-H1 · token guardado rechazado (401): pide otro y reintenta una sola vez', async () => {
    tokens = [tokenOk('viejo'), tokenOk('nuevo')];
    await proveedor.consultar(RUT);
    consultas = [json({}, 401), json(cuerpoOk())];

    await expect(proveedor.consultar(RUT)).resolves.toBeDefined();

    expect(pedidosDeToken()).toHaveLength(2);
    expect(bearerDe(1)).toBe('Bearer viejo');
    expect(bearerDe(2)).toBe('Bearer nuevo');
  });

  it('E10-H1 · si el token recién pedido también es rechazado, no reintenta más y lo descarta', async () => {
    tokens = [tokenOk('uno'), tokenOk('dos')];
    responde({}, 401);

    await expect(proveedor.consultar(RUT)).rejects.toBeInstanceOf(
      ConsultaSiiNoDisponible,
    );
    expect(consultasHechas()).toHaveLength(1);

    responde(cuerpoOk());
    await proveedor.consultar(RUT);
    expect(bearerDe(1)).toBe('Bearer dos');
  });

  it('E10-H1 · consulta no disponible: si no se consigue el token, lanza ConsultaSiiNoDisponible sin consultar', async () => {
    const fallas: (() => Response | Promise<Response>)[] = [
      json({ error: 'invalid_client' }, 401),
      json({ error: 'servidor' }, 500),
      json({ token_type: 'bearer' }),
      json({ access_token: '   ' }),
      () => new Response('no es json', { status: 200 }),
      () => Promise.reject(new DOMException('timeout', 'TimeoutError')),
    ];

    for (const falla of fallas) {
      tokens = [falla];

      await expect(proveedor.consultar(RUT)).rejects.toBeInstanceOf(
        ConsultaSiiNoDisponible,
      );
    }
    expect(consultasHechas()).toHaveLength(0);
  });

  it('E10-H1 · un pedido de token fallido no queda guardado: la siguiente consulta lo vuelve a pedir', async () => {
    tokens = [json({}, 500), tokenOk()];

    await expect(proveedor.consultar(RUT)).rejects.toBeInstanceOf(
      ConsultaSiiNoDisponible,
    );
    await expect(proveedor.consultar(RUT)).resolves.toBeDefined();

    expect(pedidosDeToken()).toHaveLength(2);
  });

  it('E10-H1 · el RUT de 7 dígitos también se escribe con puntos', async () => {
    responde(cuerpoOk(situacionDe([], '1234567-4')));

    await proveedor.consultar('1234567-4');

    const [, opciones] = consultasHechas()[0]!;
    expect(JSON.parse(opciones?.body as string)).toEqual({
      RequestData: { RolUnicoTributario: '1.234.567-4' },
    });
  });

  it('E10-H1 · con actividades: devuelve el código, el nombre y la fecha de cada una, y el id de la operación', async () => {
    responde(cuerpoOk());

    const situacion = await proveedor.consultar(RUT);

    expect(proveedor.nombre).toBe('khipu');
    expect(situacion).toEqual({
      operacion: '6baf6c19-e485-463b-ae24-a821b025c8a4',
      contribuyente: 'Khipu.S.A',
      actividades: [
        {
          codigo: '960200',
          nombre: 'ACTIVIDADES DE PELUQUERIA Y OTROS TRATAMIENTOS DE BELLEZA',
          fechaInicio: '2017-07-21',
        },
      ],
    });
  });

  it('SCRUM-163 · el nombre del contribuyente viene recortado; vacío, ausente o sin Data queda en null', async () => {
    responde(
      cuerpoOk({ ...situacionDe([ACTIVIDAD]), Name: '  SOTO MARCELA ' }),
    );
    expect((await proveedor.consultar(RUT)).contribuyente).toBe('SOTO MARCELA');

    for (const cuerpo of [
      cuerpoOk({ ...situacionDe([ACTIVIDAD]), Name: '   ' }),
      cuerpoOk({ ...situacionDe([ACTIVIDAD]), Name: undefined }),
      cuerpoOk({ ...situacionDe([ACTIVIDAD]), Name: 42 }),
      cuerpoOk(null),
    ]) {
      responde(cuerpo);
      expect((await proveedor.consultar(RUT)).contribuyente).toBeNull();
    }
  });

  it('E10-H1 · sin actividades: Data nula, sin lista o lista vacía son un RUT sin inicio de actividades, no un error', async () => {
    for (const cuerpo of [
      cuerpoOk(null),
      cuerpoOk(situacionDe(undefined)),
      cuerpoOk(situacionDe([])),
    ]) {
      responde(cuerpo);

      const situacion = await proveedor.consultar(RUT);

      expect(situacion.actividades).toEqual([]);
    }
  });

  it('E10-H1 · una actividad sin código se descarta y una fecha ilegible queda sin fecha', async () => {
    responde(
      cuerpoOk(
        situacionDe([
          { Activity: 'SIN CODIGO', Date: '2017-07-21' },
          { ...ACTIVIDAD, Date: '21/07/2017' },
          { ...ACTIVIDAD, Code: ' 471100 ', Activity: undefined },
        ]),
      ),
    );

    const { actividades } = await proveedor.consultar(RUT);

    expect(actividades).toEqual([
      expect.objectContaining({ codigo: '960200', fechaInicio: null }),
      { codigo: '471100', nombre: '', fechaInicio: '2017-07-21' },
    ]);
  });

  it('E10-H1 · consulta no disponible: un error de Khipu, un HTTP que no es 200 o un cuerpo ilegible lanzan ConsultaSiiNoDisponible', async () => {
    const fallas: (() => unknown)[] = [
      () =>
        responde({
          Status: 'ERROR',
          Data: null,
          Error: { Code: 'E201', Type: 'DO_NOT_RETRY', Description: 'x' },
        }),
      () => responde({ error: 'servidor' }, 500),
      () => responde({ Status: 'OK' }, 401),
      () => responde(cuerpoOk(), 202),
      () => {
        consultas = [() => new Response('no es json', { status: 200 })];
      },
      () => responde([1, 2]),
      () => responde(cuerpoOk(situacionDe({ Code: '960200' }))),
      () => responde(cuerpoOk('texto')),
    ];

    for (const preparar of fallas) {
      preparar();

      await expect(proveedor.consultar(RUT)).rejects.toBeInstanceOf(
        ConsultaSiiNoDisponible,
      );
    }
  });

  it('E10-H1 · consulta no disponible: si no responde a tiempo o la red falla, lanza ConsultaSiiNoDisponible', async () => {
    consultas = [
      () => Promise.reject(new DOMException('timeout', 'TimeoutError')),
    ];

    await expect(proveedor.consultar(RUT)).rejects.toBeInstanceOf(
      ConsultaSiiNoDisponible,
    );
  });

  it('E10-H1 · si Khipu responde por otro RUT, no se usa: nunca se decide por la situación de otro contribuyente', async () => {
    responde(cuerpoOk(situacionDe([ACTIVIDAD], '99999999-9')));

    await expect(proveedor.consultar(RUT)).rejects.toThrow('otro RUT');
  });

  it('E10-H1 · el RUT de la respuesta se compara sin puntos ni mayúsculas', async () => {
    responde(cuerpoOk(situacionDe([ACTIVIDAD], '11.222.338-k')));

    await expect(proveedor.consultar(RUT)).resolves.toBeDefined();
  });
});

describe('ProveedorNoConfigurado', () => {
  it('E10-H1 · sin credenciales de Khipu: la consulta falla como no disponible, sin llamar a nadie', async () => {
    const llamada = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', llamada);

    await expect(
      new ProveedorNoConfigurado().consultar(),
    ).rejects.toBeInstanceOf(ConsultaSiiNoDisponible);
    expect(llamada).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
