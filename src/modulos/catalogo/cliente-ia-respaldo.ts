import { Logger } from '@nestjs/common';
import {
  type ClienteIa,
  ErrorServicioIa,
  ESPERA_MAXIMA_IA_MS,
  type LecturaReverso,
} from './cliente-ia.js';
import type { TipoImagen } from './tipo-imagen.js';

export interface IntentoIa {
  /** Para el registro: «gemini-3.8-flash», «groq …». Nunca lleva datos de la foto. */
  nombre: string;
  cliente: ClienteIa;
  /** Lo más que espera este servicio; si el anterior falló antes, igual no pasa del total. */
  plazoMaximoMs: number;
}

/** Con menos de esto no vale la pena probar el siguiente servicio: no alcanzaría a responder. */
export const PLAZO_MINIMO_INTENTO_MS = 2_000;

/**
 * Cadena de respaldo de la sugerencia (decisión del 7 nov 2026): prueba cada servicio en orden y
 * pasa al siguiente si el anterior no respondió o su respuesta no sirve (`ErrorServicioIa`), sin
 * pasar del plazo total de siempre (`ESPERA_MAXIMA_IA_MS`), porque la persona espera con la
 * pantalla abierta. Una foto ilegible es una respuesta válida: no pasa al siguiente. Si todos
 * fallan, el error junta el motivo de cada uno.
 */
export class ClienteIaConRespaldo implements ClienteIa {
  private readonly logger = new Logger(ClienteIaConRespaldo.name);

  constructor(
    private readonly intentos: readonly IntentoIa[],
    private readonly plazoTotalMs = ESPERA_MAXIMA_IA_MS,
    private readonly ahora: () => number = Date.now,
  ) {}

  async leerReverso(
    imagen: Buffer,
    tipo: TipoImagen,
    plazoMs = this.plazoTotalMs,
  ): Promise<LecturaReverso> {
    const inicio = this.ahora();
    const fallos: string[] = [];
    for (const [indice, intento] of this.intentos.entries()) {
      const restante = plazoMs - (this.ahora() - inicio);
      if (restante < PLAZO_MINIMO_INTENTO_MS) {
        fallos.push(`${intento.nombre}: sin tiempo para intentarlo`);
        continue;
      }
      try {
        const lectura = await intento.cliente.leerReverso(
          imagen,
          tipo,
          Math.min(intento.plazoMaximoMs, restante),
        );
        if (indice > 0) {
          this.logger.log(
            `Sugerencia con el respaldo ${intento.nombre} (${fallos.join(' · ')}).`,
          );
        }
        return lectura;
      } catch (error) {
        if (!(error instanceof ErrorServicioIa)) throw error;
        fallos.push(`${intento.nombre}: ${error.message}`);
      }
    }
    throw new ErrorServicioIa(fallos.join(' · ') || 'Sin servicios de IA');
  }
}
