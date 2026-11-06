import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';

/**
 * Separa esta clave de la de los tokens de acceso, de la suscripción y de la baja, aunque todas
 * salgan del mismo secreto: un enlace de seguimiento no sirve para nada más.
 */
const DOMINIO = 'cabello-perfecto/seguimiento-correo';

/** Ruta de las dos acciones, bajo el prefijo `/api` (ver `SeguimientoController`). */
export const RUTA_SEGUIMIENTO = '/api/marketing/seguimiento';

/**
 * `idNotificacion.firma`: firma HMAC-SHA256 en base64url. El id correlativo queda a la vista: es
 * una excepción a RNF-07 aceptada por el equipo el 5 de noviembre de 2026 (no da acceso a nada; solo
 * permite estimar cuántos correos envía la tienda).
 */
const FORMATO_TOKEN = /^([1-9]\d{0,9})\.([\w-]{43})$/;

/** Largo máximo del destino de un clic: más que cualquier enlace que arme la tienda. */
export const MAXIMO_DESTINO = 2048;

/**
 * Enlaces de seguimiento de la publicidad (E12-H6, decisión del 5 de noviembre de 2026): la imagen
 * de apertura y la redirección de cada clic apuntan a esta API con el id de la NOTIFICACION
 * firmado. El clic firma también su destino, así nadie arma una redirección a otro sitio con un
 * enlace válido. No vencen: un correo abierto meses después también cuenta. La clave sale de
 * `JWT_ACCESS_SECRET` con separación de dominio, como `FirmaBaja`. Sin `URL_API` no hay enlaces y
 * los correos salen sin seguimiento.
 */
@Injectable()
export class FirmaSeguimiento {
  private readonly clave: Buffer;
  private readonly urlApi: string | undefined;

  constructor(config: ConfigService<Entorno, true>) {
    this.clave = createHmac(
      'sha256',
      config.get('JWT_ACCESS_SECRET', { infer: true }),
    )
      .update(DOMINIO)
      .digest();
    this.urlApi = config.get('URL_API', { infer: true });
  }

  /** La imagen de apertura de la notificación; `null` sin `URL_API`. */
  enlaceApertura(notificacionId: number): string | null {
    if (!this.urlApi) return null;
    const token = this.token(notificacionId, apertura(notificacionId));
    return `${this.urlApi}${RUTA_SEGUIMIENTO}/apertura/${token}`;
  }

  /** El enlace que registra el clic y lleva a `destino`; sin `URL_API`, el destino tal cual. */
  enlaceClic(notificacionId: number, destino: string): string {
    if (!this.urlApi || destino.length > MAXIMO_DESTINO) return destino;
    const token = this.token(notificacionId, clic(notificacionId, destino));
    return `${this.urlApi}${RUTA_SEGUIMIENTO}/clic/${token}?destino=${encodeURIComponent(destino)}`;
  }

  /** El id de la notificación si la firma es válida; si no, `null`. */
  verificarApertura(token: string): number | null {
    return this.verificar(token, apertura);
  }

  /** El id de la notificación si la firma corresponde a ese destino; si no, `null`. */
  verificarClic(token: string, destino: string): number | null {
    return this.verificar(token, (id) => clic(id, destino));
  }

  private verificar(
    token: string,
    contenido: (id: number) => string,
  ): number | null {
    const partes = FORMATO_TOKEN.exec(token);
    if (!partes) return null;
    const id = Number(partes[1]);
    const esperada = Buffer.from(this.firma(contenido(id)), 'base64url');
    const recibida = Buffer.from(partes[2], 'base64url');
    if (
      recibida.length !== esperada.length ||
      !timingSafeEqual(recibida, esperada)
    ) {
      return null;
    }
    return id;
  }

  private token(id: number, contenido: string): string {
    return `${id}.${this.firma(contenido)}`;
  }

  private firma(contenido: string): string {
    return createHmac('sha256', this.clave)
      .update(contenido, 'utf8')
      .digest('base64url');
  }
}

// Qué se firma: la acción va en el contenido, así un token de apertura no vale como clic
const apertura = (id: number): string => `apertura\n${id}`;
const clic = (id: number, destino: string): string => `clic\n${id}\n${destino}`;
