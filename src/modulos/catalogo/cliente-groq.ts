import {
  type ClienteIa,
  ErrorServicioIa,
  ESPERA_MAXIMA_IA_MS,
  INSTRUCCIONES_IA,
  interpretarRespuestaIa,
  type LecturaReverso,
} from './cliente-ia.js';
import type { TipoImagen } from './tipo-imagen.js';

/** API de Groq compatible con OpenAI. */
export const URL_GROQ = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Groq no aplica un esquema como Gemini: el modo JSON solo asegura un objeto JSON. Se le dicen
 * las claves y `interpretarRespuestaIa` valida lo que llegue, igual que con Gemini.
 */
const FORMATO_JSON = `Responde solo con un objeto JSON con exactamente estas claves: "legible" (booleano), "descripcion" (texto, hasta 600 caracteres) e "ingredientes" (texto).`;

interface RespuestaGroq {
  choices?: { message?: { content?: string | null } }[];
}

/**
 * Lectura con un modelo con visión de Groq (decisión del 7 nov 2026): el último respaldo cuando
 * Gemini no responde. Se llama con `fetch` (sin dependencia nueva) y un solo intento.
 */
export class ClienteGroq implements ClienteIa {
  constructor(
    private readonly claveApi: string,
    readonly modelo: string,
  ) {}

  async leerReverso(
    imagen: Buffer,
    tipo: TipoImagen,
    plazoMs = ESPERA_MAXIMA_IA_MS,
  ): Promise<LecturaReverso> {
    const cancelar = AbortSignal.timeout(plazoMs);
    let respuesta: Response;
    try {
      respuesta = await fetch(URL_GROQ, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.claveApi}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.modelo,
          messages: [
            { role: 'system', content: `${INSTRUCCIONES_IA}\n${FORMATO_JSON}` },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Lee el reverso de este producto.' },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${tipo.tipoContenido};base64,${imagen.toString('base64')}`,
                  },
                },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.4,
          max_completion_tokens: 2048,
        }),
        signal: cancelar,
      });
    } catch (error) {
      throw new ErrorServicioIa(
        error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'Groq no respondió a tiempo'
          : 'No se pudo conectar con Groq',
      );
    }
    if (!respuesta.ok) {
      throw new ErrorServicioIa(
        `Groq rechazó la petición (estado ${respuesta.status})`,
      );
    }
    let cuerpo: RespuestaGroq;
    try {
      cuerpo = (await respuesta.json()) as RespuestaGroq;
    } catch {
      throw new ErrorServicioIa('Groq no devolvió una respuesta válida');
    }
    return interpretarRespuestaIa(
      cuerpo.choices?.[0]?.message?.content ?? undefined,
    );
  }
}
