import { ServiceUnavailableException } from '@nestjs/common';
import { COMUNAS } from '../../../prisma/comunas.js';
import { CODIGOS_CHILEXPRESS } from './codigos-chilexpress.js';
import {
  COTIZACION_NO_DISPONIBLE,
  CotizadorChilexpress,
  CotizadorNoConfigurado,
} from './cotizador-chilexpress.js';

const CLAVE = 'clave-de-prueba';
const CONCEPCION = '08101';
const SANTIAGO = '13101';
const SOLICITUD = {
  origenCut: CONCEPCION,
  destinoCut: SANTIAGO,
  bulto: { pesoGramos: 320, altoCm: 18, anchoCm: 6, largoCm: 6 },
};

const opcion = (
  serviceTypeCode: number,
  serviceDescription: string,
  serviceValue: string,
) => ({ serviceTypeCode, serviceDescription, serviceValue });

describe('CotizadorChilexpress', () => {
  const llamada = vi.fn<typeof fetch>();
  const cotizador = new CotizadorChilexpress(CLAVE, 'https://sandbox.test');

  const respuesta = (opciones: unknown, status = 200) =>
    llamada.mockResolvedValue(
      new Response(
        JSON.stringify({ data: { courierServiceOptions: opciones } }),
        { status },
      ),
    );

  beforeEach(() => {
    llamada.mockReset();
    vi.stubGlobal('fetch', llamada);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('E7-H2 · cotización obtenida: envía la comuna, el peso y las medidas con los códigos de Chilexpress', async () => {
    respuesta([opcion(3, 'EXPRESS', '7310')]);

    await cotizador.cotizar(SOLICITUD);

    const [url, opciones] = llamada.mock.calls[0]!;
    expect(url).toBe('https://sandbox.test/rating/api/v1.0/rates/courier');
    expect(opciones?.signal).toBeInstanceOf(AbortSignal);
    expect(opciones?.headers).toMatchObject({
      'Ocp-Apim-Subscription-Key': CLAVE,
    });
    expect(JSON.parse(opciones?.body as string)).toMatchObject({
      originCountyCode: 'CONC',
      destinationCountyCode: 'STGO',
      package: { weight: '0.32', height: '18', width: '6', length: '6' },
    });
  });

  it('E7-H2 · cotización obtenida: cobra el servicio de entrega más barato, nunca uno de devolución', async () => {
    respuesta([
      opcion(2, 'PRIORITARIO', '10965'),
      opcion(14, 'EXPRESS LDEV', '7000'),
      opcion(47, 'CHEX LOG DEVOLUCION ESPECIAL', '7000'),
      opcion(3, 'EXPRESS', '7310'),
    ]);

    await expect(cotizador.cotizar(SOLICITUD)).resolves.toEqual({
      servicio: 'EXPRESS',
      tarifa: 7310,
    });
  });

  it('E7-H2 · comuna sin cobertura: sin servicios de entrega responde `null`', async () => {
    respuesta([]);
    await expect(cotizador.cotizar(SOLICITUD)).resolves.toBeNull();

    respuesta([opcion(47, 'CHEX LOG DEVOLUCION ESPECIAL', '7000')]);
    await expect(cotizador.cotizar(SOLICITUD)).resolves.toBeNull();
  });

  it('E7-H2 · comuna sin cobertura: un destino sin código no consulta a Chilexpress', async () => {
    await expect(
      cotizador.cotizar({ ...SOLICITUD, destinoCut: '99999' }),
    ).resolves.toBeNull();
    expect(llamada).not.toHaveBeenCalled();
  });

  it('E7-H2 · servicio de envíos sin respuesta: un error, un 5xx o una respuesta inválida responden 503', async () => {
    llamada.mockRejectedValueOnce(new Error('timeout'));
    await expect(cotizador.cotizar(SOLICITUD)).rejects.toThrow(
      COTIZACION_NO_DISPONIBLE,
    );

    for (const status of [401, 502]) {
      respuesta([], status);
      await expect(cotizador.cotizar(SOLICITUD)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    }

    llamada.mockResolvedValue(new Response('{"data":{}}'));
    await expect(cotizador.cotizar(SOLICITUD)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('E7-H2 · servicio de envíos sin respuesta: una bodega en una comuna sin código responde 503', async () => {
    await expect(
      cotizador.cotizar({ ...SOLICITUD, origenCut: '99999' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('E7-H2 · servicio de envíos sin respuesta: sin clave configurada responde 503', async () => {
    await expect(new CotizadorNoConfigurado().cotizar()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('el cruce cubre las comunas de la lista oficial, cada una con su propio código', () => {
    expect(Object.keys(CODIGOS_CHILEXPRESS).sort()).toEqual(
      COMUNAS.map(([codigoCut]) => codigoCut).sort(),
    );
    const codigos = Object.values(CODIGOS_CHILEXPRESS);
    expect(new Set(codigos).size).toBe(codigos.length);
  });
});
