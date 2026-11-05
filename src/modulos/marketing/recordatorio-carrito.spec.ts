import { lunesDeLaSemana } from '../../common/dominio/fechas.js';
import { ROLES } from '../../common/dominio/roles.js';
import {
  type EstadoSerieCarrito,
  puedeRecibirRecordatorio,
  recordatorioDebido,
} from './recordatorio-carrito.js';

const HORA = 60 * 60 * 1000;
/** Miércoles 4 de noviembre de 2026, 12:00 en Chile (UTC-3). */
const CAMBIO = new Date('2026-11-04T15:00:00.000Z');
const mas = (horas: number, desde = CAMBIO) =>
  new Date(desde.getTime() + horas * HORA);

const sinSerie: EstadoSerieCarrito = {
  fechaActualizacion: CAMBIO,
  fechaRecordatorio: null,
  recordatoriosEnviados: 0,
};

/** Serie que empezó con el primer recordatorio, una hora después del cambio. */
const enCurso = (enviados: number): EstadoSerieCarrito => ({
  fechaActualizacion: CAMBIO,
  fechaRecordatorio: mas(1),
  recordatoriosEnviados: enviados,
});

const dueno = {
  activo: true,
  rol: ROLES.CLIENTE,
  aceptaMarketingEmail: true,
  fechaVerificacionCorreo: new Date('2026-10-01T12:00:00.000Z'),
};

describe('recordatorioDebido', () => {
  it('E12-H4 · CA1 serie de recordatorios: antes de 1 hora sin cambios no hay recordatorio', () => {
    expect(recordatorioDebido(sinSerie, mas(0.99))).toBeNull();
  });

  it('E12-H4 · CA1 serie de recordatorios: a la hora registra el abandono e inicia la serie con el primero', () => {
    expect(recordatorioDebido(sinSerie, mas(1))).toEqual({
      numero: 1,
      iniciaSerie: true,
    });
  });

  it('E12-H4 · CA1 serie de recordatorios: el segundo sale a las 24 horas y no antes', () => {
    expect(recordatorioDebido(enCurso(1), mas(23.9))).toBeNull();
    expect(recordatorioDebido(enCurso(1), mas(24))).toEqual({
      numero: 2,
      iniciaSerie: false,
    });
  });

  it('E12-H4 · CA1 serie de recordatorios: el tercero sale a las 72 horas y no antes', () => {
    expect(recordatorioDebido(enCurso(2), mas(71.9))).toBeNull();
    expect(recordatorioDebido(enCurso(2), mas(72))).toEqual({
      numero: 3,
      iniciaSerie: false,
    });
  });

  it('E12-H4 · CA1 serie de recordatorios: hasta tres; después del tercero no hay más', () => {
    expect(recordatorioDebido(enCurso(3), mas(80))).toBeNull();
    expect(recordatorioDebido(enCurso(3), mas(24 * 30))).toBeNull();
  });

  it('E12-H4 · CA1 serie de recordatorios: un recordatorio ya enviado no se repite en la misma ventana', () => {
    expect(recordatorioDebido(enCurso(1), mas(5))).toBeNull();
    expect(recordatorioDebido(enCurso(2), mas(30))).toBeNull();
  });

  it('E12-H4 · CA1 serie de recordatorios: si la tarea se atrasó sale el que corresponde ahora, no los atrasados', () => {
    expect(recordatorioDebido(enCurso(1), mas(73))).toEqual({
      numero: 3,
      iniciaSerie: false,
    });
  });

  it('E12-H4 · CA1 serie de recordatorios: un carrito sin cambios hace más de 96 horas ya no se recuerda', () => {
    expect(recordatorioDebido(sinSerie, mas(96))).toBeNull();
    expect(recordatorioDebido(sinSerie, mas(95.9))).toEqual({
      numero: 3,
      iniciaSerie: true,
    });
  });

  it('E12-H4 · CA2 compra o cambio del carrito: un cambio después del inicio corta la serie en curso', () => {
    // Recibió el primero y modificó el carrito: la serie anterior ya no sigue
    const modificado: EstadoSerieCarrito = {
      fechaActualizacion: mas(5),
      fechaRecordatorio: mas(1),
      recordatoriosEnviados: 1,
    };
    // A las 24 h del cambio original no sale el segundo de esa serie, y no empieza otra en la semana
    expect(recordatorioDebido(modificado, mas(24))).toBeNull();
    expect(recordatorioDebido(modificado, mas(48))).toBeNull();
  });

  it('E12-H4 · CA3 una serie por semana: otro abandono en la misma semana no inicia una serie nueva', () => {
    const otroAbandono: EstadoSerieCarrito = {
      fechaActualizacion: mas(30),
      fechaRecordatorio: mas(1),
      recordatoriosEnviados: 1,
    };
    // Jueves 5 de noviembre: misma semana que la serie del miércoles 4
    expect(recordatorioDebido(otroAbandono, mas(1, mas(30)))).toBeNull();
  });

  it('E12-H4 · CA3 una serie por semana: a la semana siguiente sí inicia una serie nueva', () => {
    // Domingo 8 de noviembre 23:00 en Chile: aún la misma semana
    const domingo = new Date('2026-11-09T02:00:00.000Z');
    // Lunes 9 de noviembre 00:30 en Chile: semana siguiente
    const lunes = new Date('2026-11-09T03:30:00.000Z');
    const abandono: EstadoSerieCarrito = {
      fechaActualizacion: mas(-2, domingo),
      fechaRecordatorio: mas(1),
      recordatoriosEnviados: 3,
    };

    expect(recordatorioDebido(abandono, domingo)).toBeNull();
    expect(recordatorioDebido(abandono, lunes)).toEqual({
      numero: 1,
      iniciaSerie: true,
    });
  });
});

describe('puedeRecibirRecordatorio', () => {
  it('E12-H4 · CA1 serie de recordatorios: solo a quien acepta publicidad y verificó su correo', () => {
    expect(puedeRecibirRecordatorio(dueno)).toBe(true);
    expect(
      puedeRecibirRecordatorio({ ...dueno, aceptaMarketingEmail: false }),
    ).toBe(false);
    expect(
      puedeRecibirRecordatorio({ ...dueno, fechaVerificacionCorreo: null }),
    ).toBe(false);
    expect(puedeRecibirRecordatorio({ ...dueno, activo: false })).toBe(false);
  });

  it('E12-H4 · CA1 serie de recordatorios: el profesional también; el personal no', () => {
    expect(puedeRecibirRecordatorio({ ...dueno, rol: ROLES.PROFESIONAL })).toBe(
      true,
    );
    expect(puedeRecibirRecordatorio({ ...dueno, rol: ROLES.VENDEDOR })).toBe(
      false,
    );
  });
});

describe('lunesDeLaSemana', () => {
  it('E12-H4 · CA3 una serie por semana: la semana va de lunes a domingo en hora de Chile', () => {
    // Lunes 2 de noviembre 00:00 y domingo 8 a las 23:59 en Chile (UTC-3)
    expect(lunesDeLaSemana(new Date('2026-11-02T03:00:00.000Z'))).toBe(
      '2026-11-02',
    );
    expect(lunesDeLaSemana(new Date('2026-11-09T02:59:00.000Z'))).toBe(
      '2026-11-02',
    );
    // Domingo 1 de noviembre 23:59 en Chile, aunque en UTC ya sea lunes
    expect(lunesDeLaSemana(new Date('2026-11-02T02:59:00.000Z'))).toBe(
      '2026-10-26',
    );
  });
});
