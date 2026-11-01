import { armarBulto } from './bulto.js';

const BOTELLA = { pesoGramos: 320, altoCm: 18, anchoCm: 6, largoCm: 6 };

describe('armarBulto', () => {
  it('E7-H2 · cotización obtenida: una unidad va con su peso y sus medidas reales', () => {
    expect(armarBulto([{ ...BOTELLA, cantidad: 1 }])).toEqual(BOTELLA);
  });

  it('E7-H2 · cotización obtenida: varias unidades suman el peso y van en un cubo con el volumen total', () => {
    // 3 × 648 cm³ = 1.944 cm³: lado 12,48 cm, hacia arriba
    expect(armarBulto([{ ...BOTELLA, cantidad: 3 }])).toEqual({
      pesoGramos: 960,
      altoCm: 13,
      anchoCm: 13,
      largoCm: 13,
    });
  });

  it('E7-H2 · cotización obtenida: suma formatos distintos', () => {
    expect(
      armarBulto([
        { pesoGramos: 100, altoCm: 10, anchoCm: 10, largoCm: 10, cantidad: 1 },
        { pesoGramos: 200, altoCm: 10, anchoCm: 10, largoCm: 7, cantidad: 1 },
      ]),
    ).toEqual({ pesoGramos: 300, altoCm: 12, anchoCm: 12, largoCm: 12 });
  });

  it('sin unidades no hay bulto', () => {
    expect(armarBulto([])).toBeNull();
  });
});
