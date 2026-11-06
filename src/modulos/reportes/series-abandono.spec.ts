import { type EventoCuenta, seriesAbandono } from './series-abandono.js';

// Noviembre de 2026: Chile está en UTC-3. El lunes 2 y el lunes 9 abren semana.
const evento = (usuarioId: number, fecha: string): EventoCuenta => ({
  usuarioId,
  fecha: new Date(fecha),
});

describe('seriesAbandono', () => {
  it('E14-H3 · carritos por mes: los tres recordatorios de una serie cuentan como un solo abandono', () => {
    const series = seriesAbandono(
      [
        evento(1, '2026-11-02T13:00:00Z'),
        evento(1, '2026-11-03T12:00:00Z'),
        evento(1, '2026-11-05T12:00:00Z'),
      ],
      [],
    );

    expect(series).toEqual([
      {
        usuarioId: 1,
        inicio: new Date('2026-11-02T13:00:00Z'),
        recuperada: false,
      },
    ]);
  });

  it('E14-H3 · carritos por mes: un recordatorio de otra semana y 95 h después del inicio abre otro abandono', () => {
    const series = seriesAbandono(
      [
        evento(1, '2026-11-02T13:00:00Z'),
        evento(1, '2026-11-09T13:00:00Z'),
        evento(1, '2026-11-10T12:00:00Z'),
      ],
      [],
    );

    expect(series.map((serie) => serie.inicio)).toEqual([
      new Date('2026-11-02T13:00:00Z'),
      new Date('2026-11-09T13:00:00Z'),
    ]);
  });

  it('E14-H3 · carritos por mes: una serie que empezó el domingo y sigue el lunes es un solo abandono', () => {
    // Domingo 8 a las 23:00 de Chile, luego lunes 9 y miércoles 11
    const series = seriesAbandono(
      [
        evento(1, '2026-11-09T02:00:00Z'),
        evento(1, '2026-11-10T01:00:00Z'),
        evento(1, '2026-11-12T01:00:00Z'),
      ],
      [],
    );

    expect(series).toHaveLength(1);
  });

  it('E14-H3 · carritos por mes: en la misma semana no empieza otro abandono, aunque pasen 95 h', () => {
    // Lunes 2 y viernes 6 de la misma semana: E12-H4 no abre dos series en una semana
    const series = seriesAbandono(
      [evento(1, '2026-11-02T13:00:00Z'), evento(1, '2026-11-06T13:00:00Z')],
      [],
    );

    expect(series).toHaveLength(1);
  });

  it('E14-H3 · carritos por mes: separa las cuentas y no depende del orden de entrada', () => {
    const series = seriesAbandono(
      [
        evento(2, '2026-11-03T12:00:00Z'),
        evento(1, '2026-11-09T13:00:00Z'),
        evento(1, '2026-11-02T13:00:00Z'),
        evento(2, '2026-11-02T13:00:00Z'),
      ],
      [],
    );

    expect(
      series.map(({ usuarioId, inicio }) => [usuarioId, inicio.toISOString()]),
    ).toEqual([
      [2, '2026-11-02T13:00:00.000Z'],
      [1, '2026-11-02T13:00:00.000Z'],
      [1, '2026-11-09T13:00:00.000Z'],
    ]);
  });

  it('E14-H3 · carritos recuperados: una compra pagada dentro de 7 días desde el primer recordatorio lo recupera', () => {
    const series = seriesAbandono(
      [evento(1, '2026-11-02T13:00:00Z')],
      [evento(1, '2026-11-09T12:59:00Z')],
    );

    expect(series[0]?.recuperada).toBe(true);
  });

  it('E14-H3 · carritos recuperados: una compra pasados los 7 días, anterior al recordatorio o de otra cuenta no lo recupera', () => {
    const series = seriesAbandono(
      [evento(1, '2026-11-02T13:00:00Z')],
      [
        evento(1, '2026-11-09T13:00:00Z'),
        evento(1, '2026-11-02T12:00:00Z'),
        evento(2, '2026-11-03T12:00:00Z'),
      ],
    );

    expect(series[0]?.recuperada).toBe(false);
  });

  it('E14-H3 · carritos recuperados: una compra después de que empezó la serie siguiente recupera solo la siguiente', () => {
    // Serie 1 el viernes 6; serie 2 el martes 10, de otra semana y 97 h después
    const series = seriesAbandono(
      [evento(1, '2026-11-06T13:00:00Z'), evento(1, '2026-11-10T14:00:00Z')],
      [evento(1, '2026-11-11T12:00:00Z')],
    );

    expect(series.map((serie) => serie.recuperada)).toEqual([false, true]);
  });

  it('E14-H3 · carritos por mes: sin recordatorios no hay abandonos', () => {
    expect(seriesAbandono([], [evento(1, '2026-11-02T13:00:00Z')])).toEqual([]);
  });
});
