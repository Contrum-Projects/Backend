import { ProveedorKhipu, ProveedorNoConfigurado } from './proveedor-khipu.js';
import { ConsultaSiiNoDisponible } from './proveedor-situacion-tributaria.js';

const CLAVE = 'clave-de-prueba';
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
  const proveedor = new ProveedorKhipu(CLAVE, 'https://khipu.test');

  const responde = (cuerpo: unknown, status = 200) =>
    llamada.mockResolvedValue(new Response(JSON.stringify(cuerpo), { status }));

  beforeEach(() => {
    llamada.mockReset();
    vi.stubGlobal('fetch', llamada);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('E10-H1 · consulta enviada: POST a la situación tributaria con la clave, el RUT con puntos y un plazo', async () => {
    responde(cuerpoOk());

    await proveedor.consultar(RUT);

    const [url, opciones] = llamada.mock.calls[0]!;
    expect(url).toBe('https://khipu.test/v1/cl/services/sii.cl/tax-situation');
    expect(opciones?.method).toBe('POST');
    expect(opciones?.headers).toMatchObject({ 'x-api-key': CLAVE });
    expect(opciones?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(opciones?.body as string)).toEqual({
      RequestData: { RolUnicoTributario: '11.222.338-K' },
    });
  });

  it('E10-H1 · el RUT de 7 dígitos también se escribe con puntos', async () => {
    responde(cuerpoOk(situacionDe([], '1234567-4')));

    await proveedor.consultar('1234567-4');

    const [, opciones] = llamada.mock.calls[0]!;
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
    const fallas: (() => void)[] = [
      () =>
        responde({
          Status: 'ERROR',
          Data: null,
          Error: { Code: 'E201', Type: 'DO_NOT_RETRY', Description: 'x' },
        }),
      () => responde({ error: 'servidor' }, 500),
      () => responde({ Status: 'OK' }, 401),
      () => responde(cuerpoOk(), 202),
      () =>
        llamada.mockResolvedValue(new Response('no es json', { status: 200 })),
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
    llamada.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));

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
  it('E10-H1 · sin clave de Khipu: la consulta falla como no disponible, sin llamar a nadie', async () => {
    const llamada = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', llamada);

    await expect(
      new ProveedorNoConfigurado().consultar(),
    ).rejects.toBeInstanceOf(ConsultaSiiNoDisponible);
    expect(llamada).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
