import { estaVigente, packVigente } from './vigencia-pack.js';

describe('vigencia del pack', () => {
  it('E3-H6 · pack fuera de vigencia: los dos extremos son días incluidos', () => {
    const hoy = '2026-11-15';

    expect(estaVigente('2026-11-01', '2026-11-30', hoy)).toBe(true);
    expect(estaVigente('2026-11-15', '2026-11-15', hoy)).toBe(true);
    expect(estaVigente('2026-11-16', null, hoy)).toBe(false);
    expect(estaVigente(null, '2026-11-14', hoy)).toBe(false);
    expect(estaVigente(null, null, hoy)).toBe(true);
  });

  it('E3-H6 · pack fuera de vigencia: la condición de la base usa el mismo día', () => {
    const dia = new Date('2026-11-15T00:00:00Z');

    expect(packVigente('2026-11-15')).toEqual({
      AND: [
        {
          OR: [
            { fechaInicioVigencia: null },
            { fechaInicioVigencia: { lte: dia } },
          ],
        },
        {
          OR: [{ fechaFinVigencia: null }, { fechaFinVigencia: { gte: dia } }],
        },
      ],
    });
  });
});
