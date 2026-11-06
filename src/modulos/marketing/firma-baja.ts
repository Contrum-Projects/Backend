import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';

/**
 * Separa esta clave de la de los tokens de acceso y de la confirmación de la suscripción, aunque
 * todas salgan del mismo secreto: un token de confirmación no sirve para dar de baja.
 */
const DOMINIO = 'cabello-perfecto/baja-publicidad';

/** Largo máximo del token: el correo (254 caracteres como máximo) en base64url y la firma. */
export const MAXIMO_TOKEN_BAJA = 512;

/** `correoEnBase64url.firma`: firma HMAC-SHA256 en base64url. */
const FORMATO_TOKEN = /^([\w-]{1,400})\.([\w-]{43})$/;

/**
 * Enlace firmado para dejar de recibir publicidad (E12-H2, RNF-08, RNF-26). Va en todo correo
 * publicitario y **no vence** (decisión del 4 de noviembre de 2026): la baja debe funcionar desde
 * cualquier correo, aunque sea antiguo. Solo lleva la dirección: no se puede falsificar y lo único
 * que permite es dar de baja esa dirección. La clave sale de `JWT_ACCESS_SECRET` con separación de
 * dominio, como `FirmaSuscripcion`, así no hay otra variable.
 */
@Injectable()
export class FirmaBaja {
  private readonly clave: Buffer;
  private readonly urlTienda: string;

  constructor(config: ConfigService<Entorno, true>) {
    this.clave = createHmac(
      'sha256',
      config.get('JWT_ACCESS_SECRET', { infer: true }),
    )
      .update(DOMINIO)
      .digest();
    this.urlTienda = config
      .get('URL_TIENDA', { infer: true })
      .replace(/\/+$/, '');
  }

  /**
   * Enlace de la pantalla de baja de la tienda (`cp-frontend/app/(tienda)/ofertas/baja`, SCRUM-139;
   * alineado en SCRUM-150).
   */
  enlace(email: string): string {
    return `${this.urlTienda}/ofertas/baja?token=${encodeURIComponent(this.firmar(email))}`;
  }

  firmar(email: string): string {
    const correo = Buffer.from(email, 'utf8').toString('base64url');
    return `${correo}.${this.firma(correo)}`;
  }

  /** La dirección si la firma es válida; si no, `null`. */
  verificar(token: string): string | null {
    const partes = FORMATO_TOKEN.exec(token);
    if (!partes) return null;
    const [, correo, firma] = partes;

    const esperada = Buffer.from(this.firma(correo), 'base64url');
    const recibida = Buffer.from(firma, 'base64url');
    if (
      recibida.length !== esperada.length ||
      !timingSafeEqual(recibida, esperada)
    ) {
      return null;
    }
    return Buffer.from(correo, 'base64url').toString('utf8');
  }

  private firma(contenido: string): string {
    return createHmac('sha256', this.clave)
      .update(contenido, 'utf8')
      .digest('base64url');
  }
}
