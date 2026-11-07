import { ClienteGroq } from './cliente-groq.js';
import {
  type ClienteIa,
  ClienteGemini,
  ClienteIaNoConfigurado,
  ESPERA_MAXIMA_IA_MS,
} from './cliente-ia.js';
import { ClienteIaConRespaldo, type IntentoIa } from './cliente-ia-respaldo.js';

/**
 * Cómo se reparte el plazo total de 30 s (decisión del 7 nov 2026): el modelo principal tiene la
 * mayor parte; el respaldo de Gemini, que es más rápido, menos; Groq, lo que quede.
 */
export const PLAZOS_IA_MS = {
  principal: 15_000,
  respaldoGemini: 8_000,
  groq: ESPERA_MAXIMA_IA_MS,
} as const;

export interface ConfiguracionIa {
  claveGemini?: string;
  modeloGemini: string;
  /** Vacío o igual al principal: sin respaldo de Gemini. */
  modeloRespaldo: string;
  claveGroq?: string;
  modeloGroq: string;
}

/**
 * Arma el cliente de la sugerencia según el entorno: Gemini, su modelo de respaldo y Groq, en
 * ese orden, con los que estén configurados. Sin ninguna clave, la sugerencia no está disponible.
 */
export const armarClienteIa = ({
  claveGemini,
  modeloGemini,
  modeloRespaldo,
  claveGroq,
  modeloGroq,
}: ConfiguracionIa): ClienteIa => {
  const intentos: IntentoIa[] = [];
  if (claveGemini) {
    intentos.push({
      nombre: modeloGemini,
      cliente: new ClienteGemini(claveGemini, modeloGemini),
      plazoMaximoMs: PLAZOS_IA_MS.principal,
    });
    if (modeloRespaldo && modeloRespaldo !== modeloGemini) {
      intentos.push({
        nombre: modeloRespaldo,
        cliente: new ClienteGemini(claveGemini, modeloRespaldo),
        plazoMaximoMs: PLAZOS_IA_MS.respaldoGemini,
      });
    }
  }
  if (claveGroq) {
    intentos.push({
      nombre: `groq ${modeloGroq}`,
      cliente: new ClienteGroq(claveGroq, modeloGroq),
      plazoMaximoMs: PLAZOS_IA_MS.groq,
    });
  }
  if (intentos.length === 0) return new ClienteIaNoConfigurado();
  return new ClienteIaConRespaldo(intentos);
};
