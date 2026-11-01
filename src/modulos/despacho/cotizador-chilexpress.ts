import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { CODIGOS_CHILEXPRESS } from './codigos-chilexpress.js';
import {
  CotizadorEnvio,
  type SolicitudCotizacion,
  type TarifaEnvio,
} from './cotizador-envio.js';

export const COTIZACION_NO_DISPONIBLE =
  'No pudimos cotizar el despacho en este momento. Intenta de nuevo o elige retiro en tienda.';

/** Si Chilexpress no responde en este plazo, la petición falla con 503. */
const PLAZO_RESPUESTA_MS = 10_000;
const RUTA_TARIFAS = '/rating/api/v1.0/rates/courier';
/** Encomienda con contenido general. */
const PRODUCTO_ENCOMIENDA = 3;
const CONTENIDO_GENERAL = 1;
/** Todos los servicios disponibles, sin filtrar por plazo de entrega. */
const TODOS_LOS_PLAZOS = 0;

/**
 * Los servicios con que se entrega a un comprador (decisión del 31 de octubre de 2026): Prioritario,
 * Express, Extendido, Extremos y Encomiendas Grandes. Chilexpress también lista, al mismo precio, los
 * de logística de devolución (`LDEV`, `Log Dev`, `CHEX LOG DEVOLUCION ESPECIAL`): esos no se cobran.
 * Con un servicio nuevo sin revisar, la comuna queda sin cobertura y no se cobra de menos.
 */
const SERVICIOS_DE_ENTREGA: ReadonlySet<number> = new Set([2, 3, 4, 5, 41]);

interface OpcionServicio {
  serviceTypeCode?: number;
  serviceDescription?: string;
  serviceValue?: string;
}

interface RespuestaTarifas {
  data?: { courierServiceOptions?: OpcionServicio[] };
}

/** El servicio de entrega más barato; `null` si no hay ninguno. */
const masBarato = (opciones: OpcionServicio[]): TarifaEnvio | null => {
  let mejor: TarifaEnvio | null = null;
  for (const opcion of opciones) {
    const tarifa = Number(opcion.serviceValue);
    if (
      !SERVICIOS_DE_ENTREGA.has(opcion.serviceTypeCode ?? -1) ||
      !opcion.serviceDescription ||
      !Number.isInteger(tarifa) ||
      tarifa <= 0
    ) {
      continue;
    }
    if (!mejor || tarifa < mejor.tarifa) {
      mejor = { servicio: opcion.serviceDescription, tarifa };
    }
  }
  return mejor;
};

/** API Cotizador de Chilexpress Developers. Una respuesta sin servicios significa sin cobertura. */
export class CotizadorChilexpress extends CotizadorEnvio {
  private readonly logger = new Logger('Chilexpress');

  constructor(
    private readonly claveSuscripcion: string,
    private readonly urlBase: string,
  ) {
    super();
  }

  async cotizar({
    origenCut,
    destinoCut,
    bulto,
  }: SolicitudCotizacion): Promise<TarifaEnvio | null> {
    const origen = CODIGOS_CHILEXPRESS[origenCut];
    if (!origen) {
      this.logger.error(
        `La comuna ${origenCut} de la bodega no tiene código en Chilexpress.`,
      );
      throw new ServiceUnavailableException(COTIZACION_NO_DISPONIBLE);
    }
    const destino = CODIGOS_CHILEXPRESS[destinoCut];
    if (!destino) return null;

    try {
      const respuesta = await fetch(`${this.urlBase}${RUTA_TARIFAS}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': this.claveSuscripcion,
        },
        body: JSON.stringify({
          originCountyCode: origen,
          destinationCountyCode: destino,
          package: {
            weight: (bulto.pesoGramos / 1000).toFixed(2),
            height: String(bulto.altoCm),
            width: String(bulto.anchoCm),
            length: String(bulto.largoCm),
          },
          productType: PRODUCTO_ENCOMIENDA,
          contentType: CONTENIDO_GENERAL,
          // Obligatorio, pero no cambia la tarifa: se declara el valor al generar la orden de transporte
          declaredWorth: '0',
          deliveryTime: TODOS_LOS_PLAZOS,
        }),
        signal: AbortSignal.timeout(PLAZO_RESPUESTA_MS),
      });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      const cuerpo = (await respuesta.json()) as RespuestaTarifas;
      const opciones = cuerpo.data?.courierServiceOptions;
      if (!Array.isArray(opciones)) {
        throw new Error('Respuesta sin la lista de servicios.');
      }
      return masBarato(opciones);
    } catch (error) {
      this.logger.error(
        `No se pudo cotizar en Chilexpress: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(COTIZACION_NO_DISPONIBLE);
    }
  }
}

/** Sin clave de Chilexpress: la app arranca, pero cotizar el despacho responde 503. */
export class CotizadorNoConfigurado extends CotizadorEnvio {
  cotizar(): Promise<TarifaEnvio | null> {
    return Promise.reject(
      new ServiceUnavailableException(COTIZACION_NO_DISPONIBLE),
    );
  }
}
