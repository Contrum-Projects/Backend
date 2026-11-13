/** Una actividad económica de un contribuyente en el SII. */
export interface ActividadSii {
  /** Código del giro, tal como lo entrega el SII (`960200`). */
  codigo: string;
  nombre: string;
  /** Fecha desde la que tiene la actividad, AAAA-MM-DD; `null` si el proveedor no la entrega. */
  fechaInicio: string | null;
}

/** Lo que el SII informa de un RUT: sus actividades económicas. Sin actividades, no hay inicio. */
export interface SituacionTributaria {
  actividades: ActividadSii[];
  /**
   * Nombre o razón social del contribuyente, como lo entrega el SII; `null` si el proveedor no lo
   * informa. Sin él la solicitud no se aprueba sola (SCRUM-163).
   */
  contribuyente: string | null;
  /** Identificador de la consulta en el proveedor, para reclamar con él; `null` si no lo hay. */
  operacion: string | null;
}

/**
 * La consulta no se pudo hacer: el proveedor no respondió a tiempo, devolvió un error o una
 * respuesta que no se entiende, o no está configurado. No dice nada del RUT: quien solicita la
 * verificación sigue por la vía de los documentos (E10-H1).
 */
export class ConsultaSiiNoDisponible extends Error {
  override readonly name = 'ConsultaSiiNoDisponible';
}

/**
 * Proveedor que consulta la «Situación tributaria de terceros» del SII (E10-H1). El servicio de
 * negocio solo conoce esta interfaz: en producción es Khipu y se puede cambiar de proveedor sin
 * tocarlo; en las pruebas es un doble.
 */
export abstract class ProveedorSituacionTributaria {
  /** Quién responde, para dejarlo registrado en la solicitud (`PROVEEDORES_SII`). */
  abstract readonly nombre: string;

  /**
   * Las actividades del RUT (formato único: `12345678-K`). Lanza `ConsultaSiiNoDisponible` si no
   * se pudo consultar; un RUT sin actividades no es un error: devuelve la lista vacía.
   */
  abstract consultar(rut: string): Promise<SituacionTributaria>;
}
