import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ESTADOS_ENVIO, type Valor } from '../../common/dominio/valores.js';
import {
  type ConsultaSeguimiento,
  SEGUIMIENTO_NO_DISPONIBLE,
  SeguimientoEnvio,
} from './seguimiento-envio.js';

type EstadoEnvio = Valor<typeof ESTADOS_ENVIO>;

/** Si Chilexpress no responde en este plazo, la consulta falla y se conserva el último estado. */
const PLAZO_RESPUESTA_MS = 10_000;
const RUTA_TRACKING = '/transport-orders/api/v1.0/tracking';
/** `showTrackingEvents = 1`: el estado actual no trae código, solo los eventos lo traen. */
const MOSTRAR_EVENTOS = 1;
const CONSULTA_EXITOSA = 0;
/** «La OT no se encuentra disponible para consultar». */
const OT_NO_DISPONIBLE = -41;

/**
 * `code.eventCode` que aparecen en la documentación de Chilexpress (no publica un catálogo): 4
 * RECEPCIONADO, 11 EN TRANSITO AL DESTINO, 13 EN RUTA, 14 ENTREGADA A DESTINATARIO. Un código
 * que no está aquí no cambia el estado. `con_problema` no tiene código conocido.
 */
const ESTADO_POR_EVENTO: ReadonlyMap<string, EstadoEnvio> = new Map([
  ['4', ESTADOS_ENVIO.EN_TRANSITO],
  ['11', ESTADOS_ENVIO.EN_TRANSITO],
  ['13', ESTADOS_ENVIO.EN_REPARTO],
  ['14', ESTADOS_ENVIO.ENTREGADO],
]);

interface EventoTracking {
  eventDateTime?: string;
  code?: { eventCode?: string | number };
}

/** Solo lo que se usa: el resto trae datos personales del receptor y no debe guardarse ni registrarse. */
interface RespuestaTracking {
  data?: { trackingEvents?: EventoTracking[] } | null;
  statusCode?: number;
}

const codigoDe = (evento: EventoTracking): string =>
  String(evento.code?.eventCode ?? '');

const fechaDe = (evento: EventoTracking): number =>
  Date.parse(evento.eventDateTime ?? '');

/** El evento más reciente con fecha válida; ante un empate, el primero de la lista. */
const masReciente = (eventos: EventoTracking[]): EventoTracking | null => {
  let ultimo: EventoTracking | null = null;
  for (const evento of eventos) {
    if (Number.isNaN(fechaDe(evento))) continue;
    if (!ultimo || fechaDe(evento) > fechaDe(ultimo)) ultimo = evento;
  }
  return ultimo;
};

/** Tracking de la API Envíos de Chilexpress Developers (E7-H3). */
export class SeguimientoChilexpress extends SeguimientoEnvio {
  private readonly logger = new Logger('Chilexpress');

  constructor(
    private readonly claveSuscripcion: string,
    private readonly urlBase: string,
    /** RUT de la empresa dueña de las OT, sin dígito verificador. */
    private readonly rutEmpresa: number,
  ) {
    super();
  }

  async consultar({
    codigoSeguimiento,
    referencia,
  }: ConsultaSeguimiento): Promise<EstadoEnvio | null> {
    const numeroOt = Number(codigoSeguimiento);
    if (!Number.isSafeInteger(numeroOt)) return null;

    try {
      const respuesta = await fetch(`${this.urlBase}${RUTA_TRACKING}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': this.claveSuscripcion,
        },
        body: JSON.stringify({
          reference: referencia,
          transportOrderNumber: numeroOt,
          rut: this.rutEmpresa,
          showTrackingEvents: MOSTRAR_EVENTOS,
        }),
        signal: AbortSignal.timeout(PLAZO_RESPUESTA_MS),
      });
      if (respuesta.status >= 500) throw new Error(`HTTP ${respuesta.status}`);

      const cuerpo = (await respuesta.json()) as RespuestaTracking;
      if (cuerpo.statusCode === OT_NO_DISPONIBLE) return null;
      if (!respuesta.ok || cuerpo.statusCode !== CONSULTA_EXITOSA) {
        throw new Error(
          `HTTP ${respuesta.status}, resultado ${cuerpo.statusCode}`,
        );
      }
      return this.estadoDe(cuerpo.data?.trackingEvents ?? []);
    } catch (error) {
      this.logger.error(
        `No se pudo consultar el seguimiento en Chilexpress: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(SEGUIMIENTO_NO_DISPONIBLE);
    }
  }

  /**
   * Según el evento conocido más reciente: un código sin traducir posterior a la entrega no debe
   * impedir registrarla. Si el último evento no se reconoce, queda en el log para agregarlo.
   */
  private estadoDe(eventos: EventoTracking[]): EstadoEnvio | null {
    const ultimo = masReciente(eventos);
    if (ultimo && !ESTADO_POR_EVENTO.has(codigoDe(ultimo))) {
      this.logger.warn(
        `Evento de Chilexpress sin traducción: código ${codigoDe(ultimo)}.`,
      );
    }
    const conocido = masReciente(
      eventos.filter((evento) => ESTADO_POR_EVENTO.has(codigoDe(evento))),
    );
    return conocido
      ? (ESTADO_POR_EVENTO.get(codigoDe(conocido)) ?? null)
      : null;
  }
}
