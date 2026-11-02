import { ApiError, GoogleGenAI, Type } from '@google/genai';
import { conPlazo } from '../../colas/encolar-correo.js';
import type { TipoImagen } from './tipo-imagen.js';

export const CLIENTE_IA = Symbol('CLIENTE_IA');

/**
 * Sin respuesta en este plazo, la sugerencia cuenta como no disponible (E4-H1, decisión del
 * 2 nov 2026: 30 s, a revisar con el uso). La persona espera con la pantalla abierta.
 */
export const ESPERA_MAXIMA_IA_MS = 30_000;

/** Lo que la IA lee en la foto del reverso (E4-H1, RF-04.01 y RF-04.02). */
export type LecturaReverso =
  | { legible: false }
  | { legible: true; descripcion: string; ingredientes: string | null };

export interface ClienteIa {
  /** Lanza `ErrorServicioIa` si el servicio no respondió o no se pudo usar su respuesta. */
  leerReverso(imagen: Buffer, tipo: TipoImagen): Promise<LecturaReverso>;
}

/** Su mensaje se puede registrar: nunca lleva la imagen ni el texto generado. */
export class ErrorServicioIa extends Error {}

const INSTRUCCIONES = `Eres redactor de la tienda online chilena Cabello Perfecto, que vende productos capilares.
Recibes la foto del reverso de un producto. Responde solo con el JSON pedido:
- "legible": false si la foto no muestra el reverso de un producto o su texto no se puede leer; en ese caso deja los demás campos vacíos.
- "descripcion": una descripción de venta en español de Chile, de uno o dos párrafos y hasta 600 caracteres, tuteando al cliente. Usa solo lo que dice el envase (uso, beneficios, tipo de cabello, modo de uso); no inventes propiedades, certificaciones ni resultados.
- "ingredientes": la lista de ingredientes transcrita tal como aparece en el envase, en el mismo orden y separada por comas. Vacío si la foto no la muestra.`;

/**
 * Topes que el servidor exige aunque el modelo no siga las instrucciones (por ejemplo, si el
 * texto de la foto intenta cambiarlas): holgados sobre los 600 caracteres pedidos y sobre una
 * lista INCI larga, y bajo los 5000 que acepta la descripción del producto.
 */
export const LARGO_MAXIMO_DESCRIPCION_IA = 1000;
export const LARGO_MAXIMO_INGREDIENTES_IA = 3000;

const ESQUEMA_RESPUESTA = {
  type: Type.OBJECT,
  properties: {
    legible: { type: Type.BOOLEAN },
    descripcion: { type: Type.STRING, maxLength: '600' },
    ingredientes: {
      type: Type.STRING,
      maxLength: String(LARGO_MAXIMO_INGREDIENTES_IA),
    },
  },
  required: ['legible', 'descripcion', 'ingredientes'],
  propertyOrdering: ['legible', 'descripcion', 'ingredientes'],
};

const textoDe = (valor: unknown) =>
  typeof valor === 'string' ? valor.trim() : '';

/**
 * Convierte el texto JSON que devuelve la IA en una lectura. Sin descripción cuenta como
 * ilegible: no hay nada que revisar. Lanza `ErrorServicioIa` si no es el JSON esperado.
 */
export const interpretarRespuestaIa = (
  texto: string | undefined,
): LecturaReverso => {
  let datos: unknown;
  try {
    datos = JSON.parse(texto ?? '');
  } catch {
    throw new ErrorServicioIa('La IA no devolvió un JSON válido');
  }
  if (typeof datos !== 'object' || datos === null) {
    throw new ErrorServicioIa('La IA no devolvió el objeto esperado');
  }
  const { legible, descripcion, ingredientes } = datos as Record<
    string,
    unknown
  >;
  if (typeof legible !== 'boolean') {
    throw new ErrorServicioIa('La IA no indicó si la foto es legible');
  }
  const descripcionLimpia = textoDe(descripcion);
  if (!legible || !descripcionLimpia) {
    return { legible: false };
  }
  const ingredientesLimpios = textoDe(ingredientes);
  if (
    descripcionLimpia.length > LARGO_MAXIMO_DESCRIPCION_IA ||
    ingredientesLimpios.length > LARGO_MAXIMO_INGREDIENTES_IA
  ) {
    throw new ErrorServicioIa(
      'La IA devolvió un texto más largo del permitido',
    );
  }
  return {
    legible: true,
    descripcion: descripcionLimpia,
    ingredientes: ingredientesLimpios || null,
  };
};

/** Lectura con Gemini Flash (E4-H1, decisión del 2 nov 2026). */
export class ClienteGemini implements ClienteIa {
  private readonly ia: GoogleGenAI;

  constructor(
    claveApi: string,
    private readonly modelo: string,
  ) {
    this.ia = new GoogleGenAI({ apiKey: claveApi });
  }

  async leerReverso(imagen: Buffer, tipo: TipoImagen): Promise<LecturaReverso> {
    const cancelar = new AbortController();
    let texto: string | undefined;
    try {
      const respuesta = await conPlazo(
        this.ia.models.generateContent({
          model: this.modelo,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: tipo.tipoContenido,
                    data: imagen.toString('base64'),
                  },
                },
                { text: 'Lee el reverso de este producto.' },
              ],
            },
          ],
          config: {
            systemInstruction: INSTRUCCIONES,
            responseMimeType: 'application/json',
            responseSchema: ESQUEMA_RESPUESTA,
            temperature: 0.4,
            maxOutputTokens: 2048,
            // Sin razonamiento: transcribir y redactar no lo necesita, y responde antes
            thinkingConfig: { thinkingBudget: 0 },
            abortSignal: cancelar.signal,
            // Un solo intento: los reintentos del SDK pasarían del plazo y cobrarían de más
            httpOptions: {
              timeout: ESPERA_MAXIMA_IA_MS,
              retryOptions: { attempts: 1 },
            },
          },
        }),
        ESPERA_MAXIMA_IA_MS,
        'Gemini no respondió a tiempo',
      );
      texto = respuesta.text;
    } catch (error) {
      cancelar.abort();
      throw new ErrorServicioIa(mensajeDeError(error));
    }
    return interpretarRespuestaIa(texto);
  }
}

const mensajeDeError = (error: unknown) => {
  if (error instanceof ApiError) {
    return `Gemini rechazó la petición (estado ${error.status})`;
  }
  if (
    error instanceof Error &&
    error.message === 'Gemini no respondió a tiempo'
  ) {
    return error.message;
  }
  return 'No se pudo conectar con Gemini';
};

/** Sin `GEMINI_API_KEY`: la sugerencia no está disponible y se escribe a mano. */
export class ClienteIaNoConfigurado implements ClienteIa {
  leerReverso(): Promise<LecturaReverso> {
    return Promise.reject(
      new ErrorServicioIa('La IA no está configurada (falta GEMINI_API_KEY)'),
    );
  }
}
