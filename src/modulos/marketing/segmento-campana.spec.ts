import {
  conSubcategorias,
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
    expect(leerSegmento(null)).toEqual({
      tipos: [],
      categorias: [],
      marcas: [],
    });
    expect(leerSegmento('{no es json')).toEqual({
      tipos: [],
      categorias: [],
      marcas: [],
    });
    expect(
      leerSegmento('{"tipos":["cliente","vendedor"],"categorias":[1,"x"]}'),
    ).toEqual({ tipos: ['cliente'], categorias: [1], marcas: [] });
  });

  it('E12-H3 · solo cuentas cliente y profesional: el personal nunca es destinatario', () => {
    expect(
      rolesDelSegmento({
        tipos: ['cliente', 'profesional', 'suscriptor'],
        categorias: [],
        marcas: [],
      }),
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
