import { nombreCalza } from './nombre-contribuyente.js';

describe('nombreCalza', () => {
  it('SCRUM-163 · nombre que calza: el SII lo escribe como «APELLIDOS NOMBRES» y la cuenta tiene una parte', () => {
    expect(nombreCalza('SOTO PEREZ MARCELA ANDREA', 'Marcela', 'Soto')).toBe(
      true,
    );
    expect(
      nombreCalza('SOTO PEREZ MARCELA ANDREA', 'Marcela Andrea', 'Soto Pérez'),
    ).toBe(true);
  });

  it('SCRUM-163 · no distingue tildes, ñ, mayúsculas ni guiones', () => {
    expect(nombreCalza('MUNOZ-ACUNA JOSE', 'José', 'Muñoz Acuña')).toBe(true);
    expect(nombreCalza('Núñez Ríos, Inés', 'ines', 'NUNEZ')).toBe(true);
  });

  it('SCRUM-163 · nombre que no calza: otra persona, una palabra de más o una empresa', () => {
    expect(nombreCalza('ROJAS DIAZ PEDRO', 'Marcela', 'Soto')).toBe(false);
    expect(nombreCalza('SOTO PEREZ MARCELA', 'Marcela', 'Soto Vidal')).toBe(
      false,
    );
    expect(nombreCalza('PELUQUERIA MARCELA SPA', 'Marcela', 'Soto')).toBe(
      false,
    );
  });

  it('SCRUM-163 · sin nombre del SII, o sin palabras en la cuenta, no calza', () => {
    expect(nombreCalza(null, 'Marcela', 'Soto')).toBe(false);
    expect(nombreCalza('SOTO MARCELA', ' ', '-')).toBe(false);
  });
});
