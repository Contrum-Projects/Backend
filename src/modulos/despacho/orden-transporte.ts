import type { Bulto } from './cotizador-envio.js';

/** Ambiente de prueba de Chilexpress Developers (cotización, seguimiento y OT). */
export const URL_SANDBOX_CHILEXPRESS = 'https://testservices.wschilexpress.com';

/** Una dirección para la OT: la cobertura es el código de Chilexpress (no el CUT). */
export interface DireccionOt {
  cobertura: string;
  calle: string;
  numero: string | null;
  complemento: string | null;
}

export interface ContactoOt {
  nombre: string;
  telefono: string;
  correo: string;
}

/** Lo que se le pide a Chilexpress para crear la OT de un pedido (SCRUM-153). */
export interface SolicitudOt {
  /** Cobertura de la bodega de despacho. */
  origen: string;
  destino: DireccionOt;
  /** Dirección de devolución: la de la bodega de despacho. */
  devolucion: DireccionOt;
  destinatario: ContactoOt;
  bulto: Bulto;
  /** `serviceTypeCode` del servicio cotizado al comprar. */
  codigoServicio: number;
  /** El código del pedido: así se encuentra la OT en Chilexpress y en el seguimiento. */
  referencia: string;
  /** Valor de los productos, con IVA, en pesos. */
  valorDeclarado: number;
}

export interface OtCreada {
  /** Número de la OT, solo dígitos (se guarda como `envio.codigo_seguimiento`). */
  numero: string;
  /** Etiqueta en base64, como la entrega Chilexpress; `null` si no vino. */
  etiqueta: string | null;
}

/** Chilexpress rechazó la OT o no respondió. El mensaje se puede mostrar: no trae datos personales. */
export class ErrorCreacionOt extends Error {}

/** Quién crea la OT. Sin configurar (sin TCC o sin clave), la crea el personal en el portal. */
export abstract class CreadorOrdenTransporte {
  abstract readonly configurado: boolean;
  abstract crear(solicitud: SolicitudOt): Promise<OtCreada>;
}

export class CreadorOtNoConfigurado extends CreadorOrdenTransporte {
  readonly configurado = false;

  crear(): Promise<OtCreada> {
    return Promise.reject(
      new ErrorCreacionOt('La creación de la OT no está configurada.'),
    );
  }
}
