import {
  conSubcategorias,
  filtraPorCuenta,
  leerSegmento,
  normalizarSegmento,
  rolesDelSegmento,
  textoSegmento,
  unirDestinatarios,
} from './segmento-campana.js';

describe('Segmento de campaña', () => {
  it('E12-H3 · CA1 el segmento se guarda igual sin importar el orden ni los repetidos', () => {
    const a = textoSegmento(
      normalizarSegmento({
        tipos: ['profesional', 'cliente', 'cliente'],
        categorias: [5, 2, 5],
        marcas: [],
      }),
    );
    const b = textoSegmento(
      normalizarSegmento({
        tipos: ['cliente', 'profesional'],
        categorias: [2, 5],
      }),
    );

    expect(a).toBe(b);
    expect(JSON.parse(a)).toEqual({
      tipos: ['cliente', 'profesional'],
      categorias: [2, 5],
      marcas: [],
    });
  });

  it('E12-H3 · un segmento guardado ilegible o con valores desconocidos no tiene destinatarios', () => {
    const vacio = normalizarSegmento({});
    expect(leerSegmento(null)).toEqual(vacio);
    expect(leerSegmento('{no es json')).toEqual(vacio);
    expect(
      leerSegmento('{"tipos":["cliente","vendedor"],"categorias":[1,"x"]}'),
    ).toEqual(normalizarSegmento({ tipos: ['cliente'], categorias: [1] }));
  });

  it('SCRUM-150 · los filtros de cuenta se leen y guardan; los no indicados no se escriben', () => {
    const segmento = normalizarSegmento({
      tipos: ['cliente'],
      compraEnUltimosDias: 30,
      regiones: [13, 5, 13],
      mesesCumpleanos: [12, 1],
      generos: [' Femenino ', 'Femenino'],
      conCarrito: true,
      edadMinima: null,
    });

    expect(JSON.parse(textoSegmento(segmento))).toEqual({
      tipos: ['cliente'],
      categorias: [],
      marcas: [],
      compraEnUltimosDias: 30,
      regiones: [5, 13],
      mesesCumpleanos: [1, 12],
      generos: ['Femenino'],
      conCarrito: true,
    });
    expect(leerSegmento(textoSegmento(segmento))).toEqual(segmento);
    // Un valor que no es entero o no es verdadero se lee como «sin filtro»
    expect(
      leerSegmento(
        '{"tipos":["cliente"],"pedidosMinimo":"3","conCarrito":"si"}',
      ),
    ).toMatchObject({ pedidosMinimo: null, conCarrito: false });
  });

  it('SCRUM-150 · cualquier filtro de cuenta deja fuera a los suscriptores', () => {
    const base = { tipos: ['cliente' as const] };
    expect(filtraPorCuenta(normalizarSegmento(base))).toBe(false);
    expect(
      filtraPorCuenta(normalizarSegmento({ ...base, sinComprarHaceDias: 90 })),
    ).toBe(true);
    expect(filtraPorCuenta(normalizarSegmento({ ...base, comunas: [3] }))).toBe(
      true,
    );
    expect(
      filtraPorCuenta(normalizarSegmento({ ...base, generos: ['Otro'] })),
    ).toBe(true);
    expect(
      filtraPorCuenta(normalizarSegmento({ ...base, conCarrito: true })),
    ).toBe(true);
  });

  it('E12-H3 · solo cuentas cliente y profesional: el personal nunca es destinatario', () => {
    expect(
      rolesDelSegmento(
        normalizarSegmento({ tipos: ['cliente', 'profesional', 'suscriptor'] }),
      ),
    ).toEqual(['cliente', 'profesional']);
  });

  it('E12-H3 · una categoría incluye todas sus subcategorías, a cualquier profundidad', () => {
    const todas = [
      { id: 1, padreId: null },
      { id: 2, padreId: 1 },
      { id: 3, padreId: 2 },
      { id: 4, padreId: null },
      { id: 5, padreId: 4 },
    ];

    expect(conSubcategorias([1], todas)).toEqual([1, 2, 3]);
    expect(conSubcategorias([2, 4], todas)).toEqual([2, 3, 4, 5]);
    expect(conSubcategorias([], todas)).toEqual([]);
  });

  it('E12-H3 · CA2 envío repetido: llega una sola vez a cada dirección; con cuenta y suscripción, va a la cuenta', () => {
    const { cuentas, suscriptores } = unirDestinatarios(
      [
        { id: 1, email: 'camila@correo.cl' },
        { id: 2, email: 'pedro@correo.cl' },
      ],
      [
        { id: 10, email: 'Camila@Correo.cl ' },
        { id: 11, email: 'visita@correo.cl' },
        { id: 12, email: 'visita@correo.cl' },
      ],
    );

    expect(cuentas.map((c) => c.id)).toEqual([1, 2]);
    expect(suscriptores.map((s) => s.id)).toEqual([11]);
  });
});
