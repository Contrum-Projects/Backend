import { evaluarSituacion } from './evaluar-situacion.js';
import type { ActividadSii } from './proveedor-situacion-tributaria.js';

const HOY = '2026-11-02';

const actividad = (
  codigo: string,
  fechaInicio: string | null = '2020-01-15',
): ActividadSii => ({ codigo, nombre: `Giro ${codigo}`, fechaInicio });

describe('evaluarSituacion', () => {
  it('E10-H1 · aprobación automática: el giro 960200 con inicio de actividades ya cumplido aprueba', () => {
    expect(evaluarSituacion([actividad('960200')], HOY)).toBe('aprobado');
  });

  it('E10-H1 · aprobación automática: basta una de varias actividades, y el mismo día de inicio ya vale', () => {
    expect(
      evaluarSituacion([actividad('471100'), actividad('960200', HOY)], HOY),
    ).toBe('aprobado');
  });

  it('E10-H1 · sin inicio de actividades: un RUT sin actividades no aprueba', () => {
    expect(evaluarSituacion([], HOY)).toBe('sin_inicio_actividades');
  });

  it('E10-H1 · otro giro: actividades sin el 960200 no aprueban', () => {
    expect(
      evaluarSituacion([actividad('471100'), actividad('960201')], HOY),
    ).toBe('otro_giro');
  });

  it('E10-H1 · el giro 960200 con inicio futuro o sin fecha no se puede dar por vigente: no aprueba', () => {
    expect(evaluarSituacion([actividad('960200', '2026-11-03')], HOY)).toBe(
      'sin_inicio_actividades',
    );
    expect(evaluarSituacion([actividad('960200', null)], HOY)).toBe(
      'sin_inicio_actividades',
    );
  });
});
