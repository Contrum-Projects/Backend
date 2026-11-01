import { ServiceUnavailableException } from '@nestjs/common';
import type { ESTADOS_ENVIO, Valor } from '../../common/dominio/valores.js';

export const SEGUIMIENTO_NO_DISPONIBLE =
  'No se pudo consultar el estado del envío en este momento.';

export interface ConsultaSeguimiento {
  codigoSeguimiento: string;
  /** Referencia del envío en el courier: el código público del pedido. */
  referencia: string;
}

/**
 * Courier que informa el estado de un envío (E7-H3). El servicio de negocio solo conoce esta
 * interfaz: el contrato del courier y la traducción de sus estados viven en su implementación.
 */
export abstract class SeguimientoEnvio {
  /**
   * El estado del envío con ese código, o `null` si el courier no lo conoce o informa un estado sin
   * traducción. Lanza 503 si el courier no responde.
   */
  abstract consultar(
    consulta: ConsultaSeguimiento,
  ): Promise<Valor<typeof ESTADOS_ENVIO> | null>;
}

/** Sin integración con el courier: los envíos conservan el último estado guardado. */
export class SeguimientoNoConfigurado extends SeguimientoEnvio {
  consultar(): Promise<Valor<typeof ESTADOS_ENVIO> | null> {
    return Promise.reject(
      new ServiceUnavailableException(SEGUIMIENTO_NO_DISPONIBLE),
    );
  }
}
