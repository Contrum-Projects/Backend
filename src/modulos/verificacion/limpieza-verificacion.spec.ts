import { limiteConservacionArchivos } from './limpieza-verificacion.js';

describe('limpieza de archivos de verificación (E10-H6)', () => {
  it('E10-H6 · el límite de conservación está 30 × 24 horas antes', () => {
    expect(
      limiteConservacionArchivos(new Date('2026-12-05T15:00:00.000Z')),
    ).toEqual(new Date('2026-11-05T15:00:00.000Z'));
  });
});
