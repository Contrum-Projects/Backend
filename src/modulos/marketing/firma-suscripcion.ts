import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';

/** Separa esta clave de la de los tokens de acceso, aunque ambas salgan del mismo secreto. */
const DOMINIO = 'cabello-perfecto/confirmacion-suscripcion';

/**
 * Largo máximo del token: dos fechas en milisegundos, el correo (254 caracteres como máximo) en
 * base64url y la firma. Con holgura.
 */
export const MAXIMO_TOKEN_SUSCRIPCION = 512;

/** `emitido.vence.correoEnBase64url.firma`: fechas en milisegundos y firma HMAC-SHA256 en base64url. */
const FORMATO_TOKEN = /^(\d{1,15})\.(\d{1,15})\.([\w-]{1,400})\.([\w-]{43})$/;

/** Lo que garantiza un token válido: a qué correo se envió y cuándo se emitió. */
export interface TokenSuscripcion {
  email: string;
  emitido: Date;
}

export interface EnlaceSuscripcion {
  enlace: string;
  vence: Date;
}

/**
 * Enlace firmado de confirmación de la suscripción a ofertas (E12-H1, RNF-08). LEAD no tiene dónde
 * guardar un token (decisión del 3 de noviembre de 2026): el enlace lleva el correo, cuándo se
 * emitió y cuándo vence, firmados con HMAC-SHA256. No se puede falsificar ni alargar, y la revisión
 * de pendientes puede rearmarlo igual (RNF-29). La clave sale de `JWT_ACCESS_SECRET` con separación
 * de dominio, como `FirmaSugerencia`, así no hay otra variable.
 */
@Injectable()
export class FirmaSuscripcion {
  private readonly clave: Buffer;
  private readonly vigenciaMs: number;
  private readonly urlTienda: string;

  constructor(config: ConfigService<Entorno, true>) {
    this.clave = createHmac(
      'sha256',
      config.get('JWT_ACCESS_SECRET', { infer: true }),
    )
      .update(DOMINIO)
      .digest();
    // Misma vigencia que la confirmación de la cuenta (decisión del 3 de noviembre de 2026)
    this.vigenciaMs =
      config.get('CONFIRMACION_CORREO_HORAS', { infer: true }) * 60 * 60_000;
    this.urlTienda = config
      .get('URL_TIENDA', { infer: true })
      .replace(/\/+$/, '');
  }

  /** Horas que dura vigente el enlace, para el texto del correo. */
  get horasVigencia(): number {
    return this.vigenciaMs / (60 * 60_000);
  }

  /**
   * Enlace de la pantalla de confirmación de la tienda, emitido en esa fecha. La ruta es una
   * PROPUESTA por confirmar con frontend (SCRUM-138).
   */
  enlace(email: string, emitido: Date): EnlaceSuscripcion {
    const vence = new Date(emitido.getTime() + this.vigenciaMs);
    const token = this.firmar(email, emitido, vence);
    return {
      enlace: `${this.urlTienda}/suscripcion/confirmar?token=${encodeURIComponent(token)}`,
      vence,
    };
  }

  firmar(email: string, emitido: Date, vence: Date): string {
    const contenido = `${emitido.getTime()}.${vence.getTime()}.${Buffer.from(email, 'utf8').toString('base64url')}`;
    return `${contenido}.${this.firma(contenido)}`;
  }

  /** El correo y la emisión si la firma es válida y el enlace no venció; si no, `null`. */
  verificar(token: string, ahora = new Date()): TokenSuscripcion | null {
    const partes = FORMATO_TOKEN.exec(token);
    if (!partes) return null;
    const [, emitido, vence, correo, firma] = partes;

    const esperada = Buffer.from(
      this.firma(`${emitido}.${vence}.${correo}`),
      'base64url',
    );
    const recibida = Buffer.from(firma, 'base64url');
    if (
      recibida.length !== esperada.length ||
      !timingSafeEqual(recibida, esperada)
    ) {
      return null;
    }

    if (Number(vence) <= ahora.getTime()) return null;
    return {
      email: Buffer.from(correo, 'base64url').toString('utf8'),
      emitido: new Date(Number(emitido)),
    };
  }

  private firma(contenido: string): string {
    return createHmac('sha256', this.clave)
      .update(contenido, 'utf8')
      .digest('base64url');
  }
}
