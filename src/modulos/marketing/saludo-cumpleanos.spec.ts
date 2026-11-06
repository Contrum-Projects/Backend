import {
  leerActivo,
  leerOferta,
  ofertaDelCorreo,
  textoConfiguracion,
} from './saludo-cumpleanos.js';

describe('configuración del saludo de cumpleaños (E12-H5)', () => {
  it('E12-H5 · CA2 saludo con oferta: la oferta guardada se lee igual', () => {
    const oferta = { activa: true, texto: '20 % en toda la tienda' };

    expect(leerOferta(textoConfiguracion({ activo: true, oferta }))).toEqual(
      oferta,
    );
    expect(ofertaDelCorreo(oferta)).toBe('20 % en toda la tienda');
  });

  it('E12-H5 · CA2 saludo con oferta: inactiva, conserva el texto pero el correo no la lleva', () => {
    const oferta = leerOferta(
      textoConfiguracion({
        activo: true,
        oferta: { activa: false, texto: '20 % en toda la tienda' },
      }),
    );

    expect(oferta).toEqual({ activa: false, texto: '20 % en toda la tienda' });
    expect(ofertaDelCorreo(oferta)).toBeNull();
  });

  it.each([
    ['sin segmento', null],
    ['con JSON inválido', '{oferta'],
    ['sin oferta', '{}'],
    ['activa sin texto', '{"oferta":{"activa":true,"texto":"  "}}'],
    ['con activa que no es booleano', '{"oferta":{"activa":"si","texto":"x"}}'],
  ])(
    'E12-H5 · CA2 saludo con oferta: un valor guardado %s cuenta como sin oferta',
    (_caso, segmento) => {
      expect(ofertaDelCorreo(leerOferta(segmento))).toBeNull();
    },
  );

  it('SCRUM-150 · el saludo apagado se guarda y se lee apagado, con su oferta intacta', () => {
    const guardado = textoConfiguracion({
      activo: false,
      oferta: { activa: true, texto: '20 %' },
    });

    expect(leerActivo(guardado)).toBe(false);
    expect(leerOferta(guardado)).toEqual({ activa: true, texto: '20 %' });
  });

  it.each([
    ['sin segmento', null],
    ['guardado antes de SCRUM-150 (sin activo)', '{"oferta":{"activa":false}}'],
    ['con JSON inválido', '{activo'],
    ['con activo que no es booleano', '{"activo":"no"}'],
  ])(
    'SCRUM-150 · un saludo %s sigue activo, como antes de poder apagarlo',
    (_caso, segmento) => {
      expect(leerActivo(segmento)).toBe(true);
    },
  );
});
