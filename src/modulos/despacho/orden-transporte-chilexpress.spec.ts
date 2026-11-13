import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CreadorOtChilexpress,
  cuerpoOt,
} from './orden-transporte-chilexpress.js';
import { ErrorCreacionOt, type SolicitudOt } from './orden-transporte.js';

const SOLICITUD: SolicitudOt = {
  origen: 'STGO',
  destino: {
    cobertura: 'PROV',
    calle: 'Avenida Manuel Montt',
    numero: '427',
    complemento: 'Depto. 301',
  },
  devolucion: {
    cobertura: 'STGO',
    calle: 'Av. Matta 1234',
    numero: null,
    complemento: null,
  },
  destinatario: {
    nombre: 'Camila Rojas',
    telefono: '+56912345678',
    correo: 'camila@correo.cl',
  },
  bulto: { pesoGramos: 320, altoCm: 18, anchoCm: 6, largoCm: 6 },
  codigoServicio: 3,
  referencia: 'AB12CD34EF56',
  valorDeclarado: 25990,
};

const CLAVE = 'clave-envios';
const REMITENTE = {
  nombre: 'Cabello Perfecto',
  telefono: '+56911111111',
  correo: 'despachos@cabelloperfecto.cl',
};
const TCC = '18578680';

const respuesta = (cuerpo: unknown, status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(cuerpo), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );

const EXITO = {
  data: {
    header: { certificateNumber: 712100832940, countOfGeneratedOrders: 1 },
    detail: [
      {
        transportOrderNumber: 712100833404,
        reference: 'AB12CD34EF56',
        label: { labelData: 'JVBERi0xLjQ=', labelType: 'Binary' },
      },
    ],
  },
  statusCode: 0,
  statusDescription: 'Extraccion exitosa',
  errors: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('Crear la OT en Chilexpress (SCRUM-153)', () => {
  it('SCRUM-153 · arma el cuerpo de la API Envíos: TCC, origen, destino y devolución, contactos y un bulto', () => {
    expect(cuerpoOt(SOLICITUD, TCC, REMITENTE)).toEqual({
      header: {
        customerCardNumber: TCC,
        countyOfOriginCoverageCode: 'STGO',
        labelType: 2,
      },
      details: [
        {
          addresses: [
            {
              countyCoverageCode: 'PROV',
              streetName: 'Avenida Manuel Montt',
              streetNumber: '427',
              supplement: 'Depto. 301',
              addressType: 'DEST',
              deliveryOnCommercialOffice: false,
            },
            {
              countyCoverageCode: 'STGO',
              streetName: 'Av. Matta 1234',
              addressType: 'DEV',
              deliveryOnCommercialOffice: false,
            },
          ],
          contacts: [
            {
              name: 'Cabello Perfecto',
              phoneNumber: '+56911111111',
              mail: 'despachos@cabelloperfecto.cl',
              contactType: 'R',
            },
            {
              name: 'Camila Rojas',
              phoneNumber: '+56912345678',
              mail: 'camila@correo.cl',
              contactType: 'D',
            },
          ],
          packages: [
            {
              weight: '0.32',
              height: '18',
              width: '6',
              length: '6',
              serviceDeliveryCode: '3',
              productCode: '3',
              deliveryReference: 'AB12CD34EF56',
              groupReference: '',
              declaredValue: '25990',
              declaredContent: '5',
            },
          ],
        },
      ],
    });
  });

  it('SCRUM-153 · un bulto muy liviano nunca pesa 0 kilos', () => {
    const cuerpo = cuerpoOt(
      { ...SOLICITUD, bulto: { ...SOLICITUD.bulto, pesoGramos: 3 } },
      TCC,
      REMITENTE,
    );
    expect(cuerpo.details[0]!.packages[0]!.weight).toBe('0.01');
  });

  it('SCRUM-153 · CA2 creada: devuelve el número de la OT y la etiqueta, con la clave en su encabezado', async () => {
    respuesta(EXITO);
    const creador = new CreadorOtChilexpress(
      CLAVE,
      TCC,
      REMITENTE,
      'https://sandbox.test',
    );

    await expect(creador.crear(SOLICITUD)).resolves.toEqual({
      numero: '712100833404',
      etiqueta: 'JVBERi0xLjQ=',
    });
    const [url, opciones] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(
      'https://sandbox.test/transport-orders/api/v1.0/transport-orders',
    );
    expect(opciones?.method).toBe('POST');
    expect(opciones?.headers).toMatchObject({
      'Ocp-Apim-Subscription-Key': CLAVE,
    });
  });

  it('SCRUM-153 · CA3 rechazada: lanza el motivo que da Chilexpress', async () => {
    respuesta(
      {
        statusCode: 90,
        statusDescription: 'El JSON de entrada no es válido',
        errors: ['The CustomerCardNumber field is required.'],
      },
      400,
    );
    const creador = new CreadorOtChilexpress(
      CLAVE,
      TCC,
      REMITENTE,
      'https://sandbox.test',
    );

    const promesa = creador.crear(SOLICITUD);
    await expect(promesa).rejects.toThrow(ErrorCreacionOt);
    await expect(promesa).rejects.toThrow(
      'El JSON de entrada no es válido: The CustomerCardNumber field is required.',
    );
  });

  it('SCRUM-153 · CA3 sin respuesta o sin número de OT: no da una OT por creada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const creador = new CreadorOtChilexpress(
      CLAVE,
      TCC,
      REMITENTE,
      'https://sandbox.test',
    );
    await expect(creador.crear(SOLICITUD)).rejects.toThrow(
      'Chilexpress no respondió.',
    );

    respuesta({ ...EXITO, data: { detail: [{ transportOrderNumber: null }] } });
    await expect(creador.crear(SOLICITUD)).rejects.toThrow(ErrorCreacionOt);
  });
});
