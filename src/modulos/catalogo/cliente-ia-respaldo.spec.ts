import { armarClienteIa, PLAZOS_IA_MS } from './armar-cliente-ia.js';
import { ClienteGroq } from './cliente-groq.js';
import {
  type ClienteIa,
  ClienteIaNoConfigurado,
  ErrorServicioIa,
} from './cliente-ia.js';
import { ClienteIaConRespaldo } from './cliente-ia-respaldo.js';
import type { TipoImagen } from './tipo-imagen.js';

const IMAGEN = Buffer.from('foto');
const JPEG: TipoImagen = { tipoContenido: 'image/jpeg', extension: 'jpg' };
const LECTURA = {
  legible: true as const,
  descripcion: 'Shampoo reparador.',
  ingredientes: null,
};

/** Un servicio de prueba que tarda `demoraMs` en el reloj simulado y responde o falla. */
const servicio = (
  reloj: { ms: number },
  resultado: 'ok' | 'ilegible' | 'falla',
  demoraMs = 1_000,
) => {
  const leerReverso = vi.fn<ClienteIa['leerReverso']>(() => {
    reloj.ms += demoraMs;
    if (resultado === 'falla') {
      return Promise.reject(
        new ErrorServicioIa('Gemini rechazó la petición (estado 503)'),
      );
    }
    return Promise.resolve(
      resultado === 'ok' ? LECTURA : ({ legible: false } as const),
    );
  });
  return { leerReverso };
};

describe('ClienteIaConRespaldo (SCRUM-150)', () => {
  it('E4-H1 · usa el primero que responde y no prueba los demás', async () => {
    const reloj = { ms: 0 };
    const principal = servicio(reloj, 'ok');
    const respaldo = servicio(reloj, 'ok');
    const cadena = new ClienteIaConRespaldo(
      [
        { nombre: 'principal', cliente: principal, plazoMaximoMs: 15_000 },
        { nombre: 'respaldo', cliente: respaldo, plazoMaximoMs: 8_000 },
      ],
      30_000,
      () => reloj.ms,
    );

    await expect(cadena.leerReverso(IMAGEN, JPEG)).resolves.toEqual(LECTURA);
    expect(principal.leerReverso).toHaveBeenCalledWith(IMAGEN, JPEG, 15_000);
    expect(respaldo.leerReverso).not.toHaveBeenCalled();
  });

  it('E4-H1 · si uno falla pasa al siguiente con lo que queda del plazo total', async () => {
    const reloj = { ms: 0 };
    const principal = servicio(reloj, 'falla', 15_000);
    const lite = servicio(reloj, 'falla', 8_000);
    const groq = servicio(reloj, 'ok');
    const cadena = new ClienteIaConRespaldo(
      [
        { nombre: 'principal', cliente: principal, plazoMaximoMs: 15_000 },
        { nombre: 'lite', cliente: lite, plazoMaximoMs: 8_000 },
        { nombre: 'groq', cliente: groq, plazoMaximoMs: 30_000 },
      ],
      30_000,
      () => reloj.ms,
    );

    await expect(cadena.leerReverso(IMAGEN, JPEG)).resolves.toEqual(LECTURA);
    // 30 s en total: Groq recibe los 7 s que quedan, no sus 30
    expect(groq.leerReverso).toHaveBeenCalledWith(IMAGEN, JPEG, 7_000);
  });

  it('E4-H1 · una foto ilegible es una respuesta: no pasa al respaldo', async () => {
    const reloj = { ms: 0 };
    const principal = servicio(reloj, 'ilegible');
    const respaldo = servicio(reloj, 'ok');
    const cadena = new ClienteIaConRespaldo(
      [
        { nombre: 'principal', cliente: principal, plazoMaximoMs: 15_000 },
        { nombre: 'respaldo', cliente: respaldo, plazoMaximoMs: 8_000 },
      ],
      30_000,
      () => reloj.ms,
    );

    await expect(cadena.leerReverso(IMAGEN, JPEG)).resolves.toEqual({
      legible: false,
    });
    expect(respaldo.leerReverso).not.toHaveBeenCalled();
  });

  it('E4-H1 · si todos fallan o no queda tiempo, el error junta el motivo de cada uno', async () => {
    const reloj = { ms: 0 };
    const cadena = new ClienteIaConRespaldo(
      [
        {
          nombre: 'principal',
          cliente: servicio(reloj, 'falla', 29_000),
          plazoMaximoMs: 30_000,
        },
        {
          nombre: 'groq',
          cliente: servicio(reloj, 'ok'),
          plazoMaximoMs: 30_000,
        },
      ],
      30_000,
      () => reloj.ms,
    );

    await expect(cadena.leerReverso(IMAGEN, JPEG)).rejects.toThrow(
      'principal: Gemini rechazó la petición (estado 503) · groq: sin tiempo para intentarlo',
    );
  });

  it('un error que no es del servicio de IA no se tapa con el respaldo', async () => {
    const respaldo = servicio({ ms: 0 }, 'ok');
    const cadena = new ClienteIaConRespaldo([
      {
        nombre: 'principal',
        cliente: { leerReverso: () => Promise.reject(new TypeError('bug')) },
        plazoMaximoMs: 15_000,
      },
      { nombre: 'respaldo', cliente: respaldo, plazoMaximoMs: 8_000 },
    ]);

    await expect(cadena.leerReverso(IMAGEN, JPEG)).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(respaldo.leerReverso).not.toHaveBeenCalled();
  });
});

describe('ClienteGroq (SCRUM-150)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const conRespuesta = (respuesta: Response | Error) => {
    const fetch = vi.fn(() =>
      respuesta instanceof Error
        ? Promise.reject(respuesta)
        : Promise.resolve(respuesta),
    );
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('E4-H1 · manda la foto en base64 con la instrucción y valida el JSON que devuelve', async () => {
    const fetch = conRespuesta(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                legible: true,
                descripcion: 'Shampoo reparador.',
                ingredientes: 'Aqua, Glycerin',
              }),
            },
          },
        ],
      }),
    );

    const lectura = await new ClienteGroq(
      'clave-groq',
      'modelo-vision',
    ).leerReverso(IMAGEN, JPEG, 7_000);

    expect(lectura).toEqual({
      legible: true,
      descripcion: 'Shampoo reparador.',
      ingredientes: 'Aqua, Glycerin',
    });
    const [url, opciones] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(new Headers(opciones.headers).get('authorization')).toBe(
      'Bearer clave-groq',
    );
    const cuerpo = JSON.parse(String(opciones.body)) as {
      model: string;
      response_format: unknown;
      messages: { content: unknown }[];
    };
    expect(cuerpo.model).toBe('modelo-vision');
    expect(cuerpo.response_format).toEqual({ type: 'json_object' });
    expect(JSON.stringify(cuerpo.messages[1].content)).toContain(
      `data:image/jpeg;base64,${IMAGEN.toString('base64')}`,
    );
  });

  it('E4-H1 · un estado de error, una respuesta que no es JSON o un corte se informan sin datos', async () => {
    const cliente = new ClienteGroq('clave-groq', 'modelo-vision');

    conRespuesta(new Response('sobrecargado', { status: 503 }));
    await expect(cliente.leerReverso(IMAGEN, JPEG)).rejects.toThrow(
      'Groq rechazó la petición (estado 503)',
    );

    conRespuesta(
      Response.json({ choices: [{ message: { content: 'no es json' } }] }),
    );
    await expect(cliente.leerReverso(IMAGEN, JPEG)).rejects.toThrow(
      'La IA no devolvió un JSON válido',
    );

    conRespuesta(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    await expect(cliente.leerReverso(IMAGEN, JPEG)).rejects.toThrow(
      'Groq no respondió a tiempo',
    );
  });
});

describe('armarClienteIa (SCRUM-150)', () => {
  const base = {
    modeloGemini: 'gemini-3.8-flash',
    modeloRespaldo: 'gemini-3.5-flash-lite',
    modeloGroq: 'modelo-vision',
  };
  const nombres = (cliente: ClienteIa) =>
    (
      cliente as unknown as {
        intentos: { nombre: string; plazoMaximoMs: number }[];
      }
    ).intentos.map(({ nombre, plazoMaximoMs }) => [nombre, plazoMaximoMs]);

  it('arma Gemini, su respaldo y Groq en ese orden, con su parte del plazo', () => {
    const cliente = armarClienteIa({
      ...base,
      claveGemini: 'g',
      claveGroq: 'q',
    });
    expect(nombres(cliente)).toEqual([
      ['gemini-3.8-flash', PLAZOS_IA_MS.principal],
      ['gemini-3.5-flash-lite', PLAZOS_IA_MS.respaldoGemini],
      ['groq modelo-vision', PLAZOS_IA_MS.groq],
    ]);
  });

  it('sin respaldo de Gemini, sin Groq o solo con Groq, usa lo que haya; sin claves, no hay IA', () => {
    expect(
      nombres(
        armarClienteIa({ ...base, claveGemini: 'g', modeloRespaldo: '' }),
      ),
    ).toEqual([['gemini-3.8-flash', PLAZOS_IA_MS.principal]]);
    expect(nombres(armarClienteIa({ ...base, claveGroq: 'q' }))).toEqual([
      ['groq modelo-vision', PLAZOS_IA_MS.groq],
    ]);
    expect(armarClienteIa(base)).toBeInstanceOf(ClienteIaNoConfigurado);
  });
});
