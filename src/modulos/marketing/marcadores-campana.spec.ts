import { describe, expect, it } from 'vitest';
import {
  aplicarMarcadores,
  marcadoresDesconocidos,
} from './marcadores-campana.js';

const CUENTA = {
  nombre: 'Camila',
  apellido: 'Rojas',
  urlTienda: 'https://tienda.cl/',
};
const SUSCRIPTOR = {
  nombre: null,
  apellido: null,
  urlTienda: 'https://tienda.cl',
};

describe('marcadores de campaña (SCRUM-150)', () => {
  it('SCRUM-150 · cambia cada marcador por el dato de quien recibe', () => {
    expect(
      aplicarMarcadores(
        'Hola, {nombre}: {nombre_completo} ({apellido}) en {enlace_tienda}',
        CUENTA,
      ),
    ).toBe('Hola, Camila: Camila Rojas (Rojas) en https://tienda.cl');
  });

  it('SCRUM-150 · sin nombre (suscriptor sin cuenta) quita el marcador y su coma', () => {
    expect(aplicarMarcadores('Hola, {nombre}:', SUSCRIPTOR)).toBe('Hola:');
    expect(aplicarMarcadores('{nombre}, mira esto', SUSCRIPTOR)).toBe(
      'mira esto',
    );
    expect(aplicarMarcadores('Uno, {nombre}, dos', SUSCRIPTOR)).toBe(
      'Uno, dos',
    );
    expect(aplicarMarcadores('Visita {enlace_tienda}', SUSCRIPTOR)).toBe(
      'Visita https://tienda.cl',
    );
  });

  it('SCRUM-150 · deja tal cual lo que no es un marcador conocido', () => {
    expect(aplicarMarcadores('Precio {oferta} y { nombre }', CUENTA)).toBe(
      'Precio {oferta} y { nombre }',
    );
  });

  it('SCRUM-150 · detecta los marcadores que no existen, sin repetir', () => {
    expect(
      marcadoresDesconocidos('{nombre} {correo} {oferta} {correo}'),
    ).toEqual(['correo', 'oferta']);
    expect(marcadoresDesconocidos('Hola, {nombre}')).toEqual([]);
  });
});
