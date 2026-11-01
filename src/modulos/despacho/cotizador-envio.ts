/** El paquete que se cotiza: Chilexpress recibe uno solo por envío. */
export interface Bulto {
  pesoGramos: number;
  altoCm: number;
  anchoCm: number;
  largoCm: number;
}

export interface SolicitudCotizacion {
  /** Código CUT de la comuna de la bodega que despacha. */
  origenCut: string;
  /** Código CUT de la comuna de la dirección. */
  destinoCut: string;
  bulto: Bulto;
}

/** El servicio más barato para ese envío. */
export interface TarifaEnvio {
  /** Nombre del servicio del courier (`EXPRESS`, `EXTENDIDO`...). */
  servicio: string;
  /** Lo que cobra el courier, con IVA incluido, en pesos (decisión del 31 de octubre de 2026). */
  tarifa: number;
}

/**
 * Courier que cotiza el despacho (E7-H2). El servicio de negocio solo conoce esta interfaz: en
 * producción es Chilexpress y en las pruebas un doble.
 */
export abstract class CotizadorEnvio {
  /** La tarifa del envío; `null` si no hay servicio para ese destino y bulto. 503 si no responde. */
  abstract cotizar(solicitud: SolicitudCotizacion): Promise<TarifaEnvio | null>;
}
