import { aFechaSinHora, deFechaSinHora, hoyEnLaTienda } from './fechas.js';

describe('fechas', () => {
  it('hoyEnLaTienda usa la fecha de Chile', () => {
    expect(hoyEnLaTienda(new Date('2026-10-26T02:30:00Z'))).toBe('2026-10-25');
    expect(hoyEnLaTienda(new Date('2026-10-26T03:30:00Z'))).toBe('2026-10-26');
  });

  it('convierte una fecha sin hora de ida y vuelta, sin tocar null ni undefined', () => {
    const fecha = aFechaSinHora('2026-12-31');

    expect(fecha).toEqual(new Date('2026-12-31T00:00:00Z'));
    expect(deFechaSinHora(fecha)).toBe('2026-12-31');
    expect(aFechaSinHora(null)).toBeNull();
    expect(aFechaSinHora(undefined)).toBeUndefined();
    expect(deFechaSinHora(null)).toBeNull();
  });
});
