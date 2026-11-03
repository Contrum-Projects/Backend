import { detectarTipoAntecedente } from './tipo-archivo-antecedente.js';

describe('tipo de archivo de la solicitud de verificación', () => {
  it('E10-H2 · reconoce PDF, JPG y PNG por su contenido', () => {
    expect(detectarTipoAntecedente(Buffer.from('%PDF-1.7\n...'))).toEqual({
      tipoContenido: 'application/pdf',
      extension: 'pdf',
    });
    expect(
      detectarTipoAntecedente(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])),
    ).toEqual({ tipoContenido: 'image/jpeg', extension: 'jpg' });
    expect(
      detectarTipoAntecedente(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
      ),
    ).toEqual({ tipoContenido: 'image/png', extension: 'png' });
  });

  it('E10-H2 · rechaza WebP y cualquier otro contenido, aunque el nombre diga .pdf', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBP'),
    ]);
    expect(detectarTipoAntecedente(webp)).toBeNull();
    expect(detectarTipoAntecedente(Buffer.from('MZ ejecutable'))).toBeNull();
    expect(detectarTipoAntecedente(Buffer.from(' %PDF-1.7'))).toBeNull();
    expect(detectarTipoAntecedente(Buffer.alloc(0))).toBeNull();
  });
});
