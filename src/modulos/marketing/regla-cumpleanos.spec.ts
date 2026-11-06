import { ROLES } from '../../common/dominio/roles.js';
import {
  anioEnLaTienda,
  cumpleanosDeHoy,
  esCumpleanosHoy,
  esHoraDeSaludar,
  inicioDelAnio,
  puedeRecibirSaludo,
} from './regla-cumpleanos.js';

const CUENTA = {
  activo: true,
  rol: ROLES.CLIENTE,
  aceptaMarketingEmail: true,
  fechaVerificacionCorreo: new Date('2026-10-01T12:00:00.000Z'),
  fechaNacimiento: new Date('1990-11-05T00:00:00.000Z'),
};

describe('regla del saludo de cumpleaños (E12-H5)', () => {
  it('E12-H5 · CA1 saludo enviado: el cumpleaños es el día de Chile, no el de UTC', () => {
    // 5 de noviembre a las 23:30 en Chile: en UTC ya es 6 de noviembre
    const noche = new Date('2026-11-06T02:30:00.000Z');

    expect(cumpleanosDeHoy(noche)).toEqual(['11-05']);
    expect(esCumpleanosHoy(CUENTA.fechaNacimiento, noche)).toBe(true);
    expect(
      esCumpleanosHoy(CUENTA.fechaNacimiento, new Date('2026-11-06T03:00:00Z')),
    ).toBe(false);
  });

  it('E12-H5 · CA1 saludo enviado: sale desde las 9:00 de Chile, no antes', () => {
    // Noviembre: Chile está en UTC-3
    expect(esHoraDeSaludar(new Date('2026-11-05T11:59:59.000Z'))).toBe(false);
    expect(esHoraDeSaludar(new Date('2026-11-05T12:00:00.000Z'))).toBe(true);
    // Julio: Chile está en UTC-4
    expect(esHoraDeSaludar(new Date('2026-07-10T12:59:00.000Z'))).toBe(false);
    expect(esHoraDeSaludar(new Date('2026-07-10T13:00:00.000Z'))).toBe(true);
  });

  it('E12-H5 · nacido un 29 de febrero: en un año no bisiesto se saluda el 28 de febrero', () => {
    const nacimiento = new Date('2000-02-29T00:00:00.000Z');

    expect(cumpleanosDeHoy(new Date('2027-02-28T15:00:00.000Z'))).toEqual([
      '02-28',
      '02-29',
    ]);
    expect(
      esCumpleanosHoy(nacimiento, new Date('2027-02-28T15:00:00.000Z')),
    ).toBe(true);
    expect(
      esCumpleanosHoy(nacimiento, new Date('2027-03-01T15:00:00.000Z')),
    ).toBe(false);
  });

  it('E12-H5 · nacido un 29 de febrero: en un año bisiesto se saluda el 29 y no el 28', () => {
    const nacimiento = new Date('2000-02-29T00:00:00.000Z');

    expect(cumpleanosDeHoy(new Date('2028-02-28T15:00:00.000Z'))).toEqual([
      '02-28',
    ]);
    expect(
      esCumpleanosHoy(nacimiento, new Date('2028-02-29T15:00:00.000Z')),
    ).toBe(true);
  });

  it('E12-H5 · CA1 una vez en el año: el año empieza el 1 de enero a las 0:00 de Chile', () => {
    // Enero: Chile está en UTC-3
    expect(inicioDelAnio(2027)).toEqual(new Date('2027-01-01T03:00:00.000Z'));
    expect(anioEnLaTienda(new Date('2027-01-01T02:59:00.000Z'))).toBe(2026);
    expect(anioEnLaTienda(new Date('2027-01-01T03:00:00.000Z'))).toBe(2027);
  });

  it('E12-H5 · CA1 saludo enviado: recibe el saludo una cuenta cliente o profesional activa, verificada, que acepta publicidad y con fecha', () => {
    expect(puedeRecibirSaludo(CUENTA)).toBe(true);
    expect(puedeRecibirSaludo({ ...CUENTA, rol: ROLES.PROFESIONAL })).toBe(
      true,
    );
  });

  it.each([
    ['sin fecha de nacimiento', { fechaNacimiento: null }],
    ['que no acepta publicidad', { aceptaMarketingEmail: false }],
    ['sin el correo verificado', { fechaVerificacionCorreo: null }],
    ['desactivada', { activo: false }],
    ['del personal', { rol: ROLES.ADMINISTRADOR }],
  ])(
    'E12-H5 · CA3 sin fecha o sin consentimiento: una cuenta %s no se saluda',
    (_caso, cambio) => {
      expect(puedeRecibirSaludo({ ...CUENTA, ...cambio })).toBe(false);
    },
  );
});
