import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';

/** Separa esta clave de la de los tokens de acceso, aunque ambas salgan del mismo secreto. */
const DOMINIO = 'cabello-perfecto/sugerencia-descripcion';

/** La firma es un HMAC-SHA256 en hexadecimal. */
export const FORMATO_FIRMA = /^[0-9a-f]{64}$/;

/**
 * Firma la descripción que sugiere la IA (E4-H1) para que, al guardar el producto (E4-H2), el
 * servidor sepa que el texto de partida vino de la IA sin guardar la sugerencia en ningún lado.
 * La clave sale de `JWT_ACCESS_SECRET` con separación de dominio, así no hay otra variable.
 */
@Injectable()
export class FirmaSugerencia {
  private readonly clave: Buffer;

  constructor(config: ConfigService<Entorno, true>) {
    this.clave = createHmac(
      'sha256',
      config.get('JWT_ACCESS_SECRET', { infer: true }),
    )
      .update(DOMINIO)
      .digest();
  }

  firmar(descripcion: string): string {
    return createHmac('sha256', this.clave)
      .update(descripcion, 'utf8')
      .digest('hex');
  }

  /** `true` solo si la firma corresponde a esa descripción; compara en tiempo constante. */
  verificar(descripcion: string, firma: string): boolean {
    if (!FORMATO_FIRMA.test(firma)) return false;
    return timingSafeEqual(
      Buffer.from(this.firmar(descripcion), 'hex'),
      Buffer.from(firma, 'hex'),
    );
  }
}
