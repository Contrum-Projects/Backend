/**
 * CSV para abrir en Excel con configuración de Chile (E14-H5, SCRUM-159): separador `;` (la coma
 * es el separador decimal), saltos `\r\n` y BOM UTF-8 para que respete las tildes.
 */
const SEPARADOR = ';';
const SALTO = '\r\n';
const BOM = '﻿';

export type CeldaCsv = string | number;

/**
 * Un texto que empieza con `=`, `+`, `-`, `@`, tabulación o retorno, Excel lo ejecuta como
 * fórmula (inyección CSV, OWASP): se le antepone un apóstrofo para que quede como texto. Los
 * números se escriben tal cual para que la planilla pueda sumarlos.
 */
const PELIGROSO = /^[=+\-@\t\r]/;

const celda = (valor: CeldaCsv): string => {
  if (typeof valor === 'number') return String(valor);
  const seguro = PELIGROSO.test(valor) ? `'${valor}` : valor;
  return /[";\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
};

const linea = (celdas: readonly CeldaCsv[]): string =>
  celdas.map(celda).join(SEPARADOR);

/** El archivo completo: BOM, encabezados y una línea por fila. Sin filas, solo los encabezados. */
export const armarCsv = (
  encabezados: readonly string[],
  filas: readonly (readonly CeldaCsv[])[],
): string => BOM + [encabezados, ...filas].map(linea).join(SALTO) + SALTO;
