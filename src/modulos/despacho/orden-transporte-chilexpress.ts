import { Logger } from '@nestjs/common';
import {
  type ContactoOt,
  CreadorOrdenTransporte,
  type DireccionOt,
  ErrorCreacionOt,
  type OtCreada,
  type SolicitudOt,
} from './orden-transporte.js';

const RUTA = '/transport-orders/api/v1.0/transport-orders';
/**
 * Si Chilexpress no responde en este plazo, la OT no se crea y el pedido no cambia. Su ambiente de
 * prueba tardó de 8 a más de 15 s en crear una (9 nov): 30 s deja margen sin colgar al personal.
 */
const PLAZO_RESPUESTA_MS = 30_000;
/** `labelType` 2: la etiqueta como imagen en binario, más sus datos. */
const ETIQUETA_IMAGEN = 2;
/** `productCode` 3: encomienda. */
const ENCOMIENDA = '3';
/** `declaredContent` 5: otros (productos capilares). PROPUESTA por confirmar. */
const CONTENIDO_OTROS = '5';
const EXITO = 0;

interface RespuestaOt {
  data?: {
    detail?: {
      transportOrderNumber?: number | string;
      label?: { labelData?: string | null } | null;
    }[];
  } | null;
  statusCode?: number;
  statusDescription?: string;
  errors?: string[] | string | null;
}

/** Peso en kilos con dos decimales y punto; nunca 0, que Chilexpress rechaza. */
const kilos = (gramos: number) => Math.max(gramos / 1000, 0.01).toFixed(2);

const direccion = (d: DireccionOt, tipo: 'DEST' | 'DEV') => ({
  countyCoverageCode: d.cobertura,
  streetName: d.calle.slice(0, 100),
  ...(d.numero && { streetNumber: d.numero.slice(0, 10) }),
  ...(d.complemento && { supplement: d.complemento }),
  addressType: tipo,
  deliveryOnCommercialOffice: false,
});

/** El cuerpo de `POST /transport-orders` según la documentación de la API Envíos (9 nov). */
export const cuerpoOt = (
  s: SolicitudOt,
  tarjetaCliente: string,
  remitente: ContactoOt,
) => ({
  header: {
    customerCardNumber: tarjetaCliente,
    countyOfOriginCoverageCode: s.origen,
    labelType: ETIQUETA_IMAGEN,
  },
  details: [
    {
      addresses: [direccion(s.destino, 'DEST'), direccion(s.devolucion, 'DEV')],
      contacts: [
        {
          name: remitente.nombre,
          phoneNumber: remitente.telefono,
          mail: remitente.correo,
          contactType: 'R',
        },
        {
          name: s.destinatario.nombre.slice(0, 100),
          phoneNumber: s.destinatario.telefono.slice(0, 15),
          mail: s.destinatario.correo,
          contactType: 'D',
        },
      ],
      packages: [
        {
          weight: kilos(s.bulto.pesoGramos),
          height: String(s.bulto.altoCm),
          width: String(s.bulto.anchoCm),
          length: String(s.bulto.largoCm),
          serviceDeliveryCode: String(s.codigoServicio),
          productCode: ENCOMIENDA,
          deliveryReference: s.referencia,
          groupReference: '',
          declaredValue: String(s.valorDeclarado),
          declaredContent: CONTENIDO_OTROS,
        },
      ],
    },
  ],
});

const motivoDe = (r: RespuestaOt): string => {
  const errores = Array.isArray(r.errors) ? r.errors.join(' ') : r.errors;
  return [r.statusDescription, errores].filter(Boolean).join(': ');
};

/** Crea la OT con la API Envíos de Chilexpress Developers (SCRUM-153). */
export class CreadorOtChilexpress extends CreadorOrdenTransporte {
  readonly configurado = true;
  private readonly logger = new Logger('Chilexpress');

  constructor(
    private readonly claveSuscripcion: string,
    private readonly tarjetaCliente: string,
    private readonly remitente: ContactoOt,
    private readonly urlBase: string,
  ) {
    super();
  }

  async crear(solicitud: SolicitudOt): Promise<OtCreada> {
    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.urlBase}${RUTA}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': this.claveSuscripcion,
        },
        body: JSON.stringify(
          cuerpoOt(solicitud, this.tarjetaCliente, this.remitente),
        ),
        signal: AbortSignal.timeout(PLAZO_RESPUESTA_MS),
      });
    } catch (error) {
      this.logger.error(`No se pudo crear la OT: ${(error as Error).name}`);
      throw new ErrorCreacionOt('Chilexpress no respondió.');
    }

    const cuerpo = (await respuesta
      .json()
      .catch(() => null)) as RespuestaOt | null;
    const ot = cuerpo?.data?.detail?.[0];
    const numero = String(ot?.transportOrderNumber ?? '');
    if (
      !respuesta.ok ||
      cuerpo?.statusCode !== EXITO ||
      !/^\d+$/.test(numero)
    ) {
      // Solo el estado y la descripción: la respuesta puede traer datos del destinatario
      const motivo = cuerpo ? motivoDe(cuerpo) : '';
      this.logger.error(
        `Chilexpress rechazó la OT (${respuesta.status}, ${cuerpo?.statusCode ?? 'sin código'}): ${motivo}`,
      );
      throw new ErrorCreacionOt(
        motivo
          ? `Chilexpress rechazó la OT: ${motivo}`
          : 'Chilexpress rechazó la OT.',
      );
    }
    return { numero, etiqueta: ot?.label?.labelData || null };
  }
}
