import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';

/** Separa esta clave de la de los tokens de acceso y de los enlaces de suscripción y de baja. */
const DOMINIO = 'cabello-perfecto/vista-previa-campana';

/** Cuánto sirve la confirmación de una vista previa (decisión del 5 de noviembre de 2026). */
export const VIGENCIA_VISTA_PREVIA_MS = 60 * 60 * 1000;
/** Tolerancia para relojes de distintas instancias: una emisión «del futuro» más allá, no sirve. */
const DESFASE_MAXIMO_MS = 60 * 1000;

/** `emisionEnSegundos.firma`: segundos Unix (10 dígitos) y HMAC-SHA256 en base64url. */
export const FORMATO_HUELLA = /^(\d{10})\.([\w-]{43})$/;

export interface ContenidoCampana {
  id: number;
  asunto: string;
  cuerpo: string;
  /** El segmento como se guarda (`textoSegmento`). */
  segmento: string;
}

export type ResultadoHuella = 'valida' | 'vencida' | 'invalida';

/**
 * Huella de la vista previa de una campaña (E12-H3, decisión del 5 de noviembre de 2026): el envío
 * exige la de una vista previa de la última hora, así se confirma exactamente lo que se vio, y con
 * destinatarios recientes. Si la campaña cambió después, la firma ya no coincide. Va firmada con
 * una clave derivada de `JWT_ACCESS_SECRET` con su propio dominio, como `FirmaSuscripcion`: no hace falta
 * otra variable ni guardarla (sin cambios al MER).
 */
@Injectable()
export class HuellaCampana {
  private readonly clave: Buffer;

  constructor(config: ConfigService<Entorno, true>) {
    this.clave = createHmac(
      'sha256',
      config.get('JWT_ACCESS_SECRET', { infer: true }),
    )
      .update(DOMINIO)
      .digest();
  }

  calcular(contenido: ContenidoCampana, emitida = new Date()): string {
    const emision = String(Math.floor(emitida.getTime() / 1000));
    return `${emision}.${this.firma(contenido, emision)}`;
  }

  verificar(
    contenido: ContenidoCampana,
    recibida: string,
    ahora = new Date(),
  ): ResultadoHuella {
    const partes = FORMATO_HUELLA.exec(recibida);
    if (!partes) return 'invalida';
    const [, emision, firma] = partes;

    const esperada = Buffer.from(this.firma(contenido, emision), 'base64url');
    const enviada = Buffer.from(firma, 'base64url');
    if (
      enviada.length !== esperada.length ||
      !timingSafeEqual(enviada, esperada)
    ) {
      return 'invalida';
    }
    const edad = ahora.getTime() - Number(emision) * 1000;
    if (edad < -DESFASE_MAXIMO_MS || edad > VIGENCIA_VISTA_PREVIA_MS) {
      return 'vencida';
    }
    return 'valida';
  }

  private firma(
    { id, asunto, cuerpo, segmento }: ContenidoCampana,
    emision: string,
  ): string {
    // JSON separa los campos sin ambigüedad: un asunto no puede «correrse» al cuerpo
    return createHmac('sha256', this.clave)
      .update(JSON.stringify([id, asunto, cuerpo, segmento, emision]), 'utf8')
      .digest('base64url');
  }
}
