import {
  leerOferta,
  ofertaDelCorreo,
  textoOferta,
} from './saludo-cumpleanos.js';

describe('configuración del saludo de cumpleaños (E12-H5)', () => {
  it('E12-H5 · CA2 saludo con oferta: la oferta guardada se lee igual', () => {
    const oferta = { activa: true, texto: '20 % en toda la tienda' };

    expect(leerOferta(textoOferta(oferta))).toEqual(oferta);
    expect(ofertaDelCorreo(oferta)).toBe('20 % en toda la tienda');
  });

  it('E12-H5 · CA2 saludo con oferta: inactiva, conserva el texto pero el correo no la lleva', () => {
    const oferta = leerOferta(
      textoOferta({ activa: false, texto: '20 % en toda la tienda' }),
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
});
