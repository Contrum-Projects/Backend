import {
  ClienteGemini,
  ClienteIaNoConfigurado,
  ESPERA_MAXIMA_IA_MS,
  ErrorServicioIa,
  interpretarRespuestaIa,
  LARGO_MAXIMO_DESCRIPCION_IA,
  LARGO_MAXIMO_INGREDIENTES_IA,
  razonamientoPara,
} from './cliente-ia.js';
import type { TipoImagen } from './tipo-imagen.js';

const { generarContenido } = vi.hoisted(() => ({
  generarContenido: vi.fn(),
}));

vi.mock('@google/genai', async (original) => {
  const real = await original<typeof import('@google/genai')>();
  return {
    ...real,
    GoogleGenAI: class {
      models = { generateContent: generarContenido };
    },
  };
});

const { ApiError } = await import('@google/genai');

const JPEG: TipoImagen = { tipoContenido: 'image/jpeg', extension: 'jpg' };
const IMAGEN = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const respuestaJson = (datos: object) => ({ text: JSON.stringify(datos) });

describe('interpretarRespuestaIa', () => {
  it('E4-H1 · sugerencia generada: devuelve la descripción y los ingredientes sin espacios sobrantes', () => {
    expect(
      interpretarRespuestaIa(
        JSON.stringify({
          legible: true,
          descripcion: '  Shampoo reparador para cabello dañado.  ',
          ingredientes: ' Aqua, Sodium Laureth Sulfate, Glycerin ',
        }),
      ),
    ).toEqual({
      legible: true,
      descripcion: 'Shampoo reparador para cabello dañado.',
      ingredientes: 'Aqua, Sodium Laureth Sulfate, Glycerin',
    });
  });

  it('E4-H1 · sin ingredientes en la foto: los devuelve como null', () => {
    expect(
      interpretarRespuestaIa(
        JSON.stringify({
          legible: true,
          descripcion: 'Acondicionador.',
          ingredientes: '   ',
        }),
      ),
    ).toEqual({
      legible: true,
      descripcion: 'Acondicionador.',
      ingredientes: null,
    });
  });

  it('E4-H1 · foto ilegible: la IA lo indica o no redacta descripción', () => {
    expect(
      interpretarRespuestaIa(
        JSON.stringify({ legible: false, descripcion: '', ingredientes: '' }),
      ),
    ).toEqual({ legible: false });
    expect(
      interpretarRespuestaIa(
        JSON.stringify({
          legible: true,
          descripcion: ' ',
          ingredientes: 'Aqua',
        }),
      ),
    ).toEqual({ legible: false });
  });

  it('E4-H1 · servicio no disponible: una respuesta que no es el JSON esperado es un error del servicio', () => {
    expect(() => interpretarRespuestaIa(undefined)).toThrow(ErrorServicioIa);
    expect(() => interpretarRespuestaIa('no es json')).toThrow(ErrorServicioIa);
    expect(() => interpretarRespuestaIa('null')).toThrow(ErrorServicioIa);
    expect(() =>
      interpretarRespuestaIa(JSON.stringify({ descripcion: 'x' })),
    ).toThrow(ErrorServicioIa);
  });
});

describe('interpretarRespuestaIa · topes', () => {
  it('E4-H1 · servicio no disponible: un texto más largo que el tope no llega al personal', () => {
    expect(() =>
      interpretarRespuestaIa(
        JSON.stringify({
          legible: true,
          descripcion: 'a'.repeat(LARGO_MAXIMO_DESCRIPCION_IA + 1),
          ingredientes: 'Aqua',
        }),
      ),
    ).toThrow(ErrorServicioIa);
    expect(() =>
      interpretarRespuestaIa(
        JSON.stringify({
          legible: true,
          descripcion: 'Shampoo.',
          ingredientes: 'a'.repeat(LARGO_MAXIMO_INGREDIENTES_IA + 1),
        }),
      ),
    ).toThrow(ErrorServicioIa);
  });
});

describe('ClienteGemini', () => {
  const cliente = new ClienteGemini('clave-gemini', 'gemini-3.8-flash');

  beforeEach(() => {
    generarContenido.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('E4-H1 · sugerencia generada: envía la foto al modelo configurado y pide JSON, en un solo intento', async () => {
    generarContenido.mockResolvedValue(
      respuestaJson({
        legible: true,
        descripcion: 'Shampoo reparador.',
        ingredientes: 'Aqua',
      }),
    );

    const lectura = await cliente.leerReverso(IMAGEN, JPEG);

    expect(lectura).toEqual({
      legible: true,
      descripcion: 'Shampoo reparador.',
      ingredientes: 'Aqua',
    });
    const [peticion] = generarContenido.mock.calls[0];
    expect(peticion.model).toBe('gemini-3.8-flash');
    expect(peticion.contents[0].parts[0].inlineData).toEqual({
      mimeType: 'image/jpeg',
      data: IMAGEN.toString('base64'),
    });
    expect(peticion.config.responseMimeType).toBe('application/json');
    expect(peticion.config.httpOptions).toEqual({
      timeout: ESPERA_MAXIMA_IA_MS,
      retryOptions: { attempts: 1 },
    });
  });

  it('E4-H1 · servicio no disponible: Gemini rechaza la petición', async () => {
    generarContenido.mockRejectedValue(
      new ApiError({ message: 'cuota agotada', status: 429 }),
    );

    await expect(cliente.leerReverso(IMAGEN, JPEG)).rejects.toThrow(
      new ErrorServicioIa('Gemini rechazó la petición (estado 429)'),
    );
  });

  it('E4-H1 · servicio no disponible: sin conexión, el mensaje no lleva el detalle del SDK', async () => {
    generarContenido.mockRejectedValue(
      new Error('fetch failed: clave-gemini expuesta'),
    );

    await expect(cliente.leerReverso(IMAGEN, JPEG)).rejects.toThrow(
      new ErrorServicioIa('No se pudo conectar con Gemini'),
    );
  });

  it('E4-H1 · servicio no disponible: sin respuesta en 30 s, corta la espera y cancela la petición', async () => {
    vi.useFakeTimers();
    let senal: AbortSignal | undefined;
    generarContenido.mockImplementation(
      (peticion: { config: { abortSignal: AbortSignal } }) => {
        senal = peticion.config.abortSignal;
        return new Promise(() => undefined);
      },
    );

    const lectura = cliente.leerReverso(IMAGEN, JPEG);
    const verificacion = expect(lectura).rejects.toThrow(
      new ErrorServicioIa('Gemini no respondió a tiempo'),
    );
    await vi.advanceTimersByTimeAsync(ESPERA_MAXIMA_IA_MS);

    await verificacion;
    expect(senal?.aborted).toBe(true);
  });
});

describe('ClienteIaNoConfigurado', () => {
  it('E4-H1 · servicio no disponible: sin GEMINI_API_KEY no hay sugerencia', async () => {
    await expect(
      new ClienteIaNoConfigurado().leerReverso(),
    ).rejects.toBeInstanceOf(ErrorServicioIa);
  });

  describe('razonamiento según el modelo (SCRUM-150)', () => {
    it('E4-H1 · los Gemini 3 usan thinkingLevel LOW; los 2.x lo apagan con thinkingBudget 0', () => {
      expect(razonamientoPara('gemini-3.8-flash')).toEqual({
        thinkingLevel: 'LOW',
      });
      expect(razonamientoPara('gemini-flash-latest')).toEqual({
        thinkingLevel: 'LOW',
      });
      expect(razonamientoPara('gemini-2.5-flash')).toEqual({
        thinkingBudget: 0,
      });
    });
  });
});
