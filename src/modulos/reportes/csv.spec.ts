import { armarCsv } from './csv.js';

const BOM = '﻿';

describe('armarCsv', () => {
  it('E14-H5 · arma el archivo con BOM, separador «;» y saltos \\r\\n', () => {
    expect(armarCsv(['Código', 'Total'], [['ABC', 1500]])).toBe(
      `${BOM}Código;Total\r\nABC;1500\r\n`,
    );
  });

  it('E14-H5 · período sin ventas: solo los encabezados', () => {
    expect(armarCsv(['Código', 'Total'], [])).toBe(`${BOM}Código;Total\r\n`);
  });

  it('E14-H5 · entrecomilla los textos con «;», comillas o saltos de línea', () => {
    expect(armarCsv(['A'], [['uno;dos'], ['dice "hola"'], ['a\nb']])).toBe(
      `${BOM}A\r\n"uno;dos"\r\n"dice ""hola"""\r\n"a\nb"\r\n`,
    );
  });

  it.each(['=1+1', '+56', '-2', '@SUMA(A1)', '\tx'])(
    'E14-H5 · protege contra fórmulas el texto %j',
    (texto) => {
      const csv = armarCsv(['A'], [[texto]]);
      expect(csv.split('\r\n')[1]).toMatch(/^"?'/);
    },
  );

  it('E14-H5 · los números quedan como números, aunque sean negativos', () => {
    expect(armarCsv(['A'], [[-10]])).toBe(`${BOM}A\r\n-10\r\n`);
  });
});
