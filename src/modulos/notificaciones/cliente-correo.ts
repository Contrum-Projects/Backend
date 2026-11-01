import { Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { conPlazo } from '../../colas/encolar-correo.js';
import { ID_LOGO } from './plantillas/base.js';
import { LOGO_PNG_BASE64 } from './plantillas/logo.js';

export const CLIENTE_CORREO = Symbol('CLIENTE_CORREO');

/** Sin respuesta en este plazo, el envío cuenta como fallido y se reintenta. */
const ESPERA_MAXIMA_ENVIO_MS = 15_000;

export interface MensajeCorreo {
  notificacionId: number;
  para: string;
  asunto: string;
  html: string;
  texto: string;
  /** Un reintento con la misma clave no duplica el correo. */
  claveIdempotencia: string;
}

export interface ClienteCorreo {
  /** Lanza `ErrorEnvioCorreo` si no se pudo enviar. */
  enviar(mensaje: MensajeCorreo): Promise<void>;
}

/** Su mensaje se puede registrar: nunca lleva el destinatario, el cuerpo ni el enlace. */
export class ErrorEnvioCorreo extends Error {}

/** Envío real por la API de Resend (decisión de E1-H6). */
export class ClienteResend implements ClienteCorreo {
  private readonly resend: Resend;

  constructor(
    claveApi: string,
    private readonly remitente: string,
  ) {
    this.resend = new Resend(claveApi);
  }

  async enviar(mensaje: MensajeCorreo): Promise<void> {
    let respuesta: Awaited<ReturnType<Resend['emails']['send']>>;
    try {
      respuesta = await conPlazo(
        this.resend.emails.send(
          {
            from: this.remitente,
            to: mensaje.para,
            subject: mensaje.asunto,
            html: mensaje.html,
            text: mensaje.texto,
            attachments: [
              {
                filename: 'logo.png',
                content: LOGO_PNG_BASE64,
                contentType: 'image/png',
                contentId: ID_LOGO,
              },
            ],
          },
          { idempotencyKey: mensaje.claveIdempotencia },
        ),
        ESPERA_MAXIMA_ENVIO_MS,
        'Resend no respondió a tiempo',
      );
    } catch (error) {
      throw new ErrorEnvioCorreo(
        (error as Error).message === 'Resend no respondió a tiempo'
          ? (error as Error).message
          : 'No se pudo conectar con Resend',
      );
    }
    // El SDK no lanza: devuelve el rechazo como dato, y sin esto contaría como enviado
    if (respuesta.error) {
      const { name, statusCode } = respuesta.error;
      throw new ErrorEnvioCorreo(
        `Resend rechazó el envío (${name}, ${statusCode ?? 'sin estado'})`,
      );
    }
  }
}

/**
 * Sin `RESEND_API_KEY`, fuera de producción: no envía nada. Registra solo la notificación, nunca
 * el enlace ni el cuerpo (RNF-02, RNF-08). Para probar un envío real: una clave de Resend y una
 * dirección de prueba como `delivered@resend.dev`.
 */
export class ClienteCorreoSimulado implements ClienteCorreo {
  private readonly logger = new Logger(ClienteCorreoSimulado.name);

  enviar({ notificacionId }: MensajeCorreo): Promise<void> {
    this.logger.log(
      `Correo simulado de la notificación ${notificacionId}: no se envió nada.`,
    );
    return Promise.resolve();
  }
}
