import { esPdf } from './tipo-archivo-factura.js';

describe('tipo de archivo de la factura', () => {
  it('E9-H3 · reconoce un PDF por su contenido', () => {
    expect(esPdf(Buffer.from('%PDF-1.7\n...'))).toBe(true);
  });

  it('E9-H3 · rechaza lo que no empieza con la firma de un PDF, aunque se llame .pdf', () => {
    expect(esPdf(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(esPdf(Buffer.from(' %PDF-1.7'))).toBe(false);
    expect(esPdf(Buffer.from('%PDF'))).toBe(false);
    expect(esPdf(Buffer.alloc(0))).toBe(false);
  });
});
