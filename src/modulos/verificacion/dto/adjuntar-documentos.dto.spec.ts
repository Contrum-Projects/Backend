import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  MENSAJE_TIPOS,
  AdjuntarDocumentosDto,
} from './adjuntar-documentos.dto.js';

const probar = async (tipos: unknown) => {
  const dto = plainToInstance(AdjuntarDocumentosDto, { tipos });
  const errores = await validate(dto);
  return { dto, errores };
};

describe('AdjuntarDocumentosDto', () => {
  it('E10-H2 · acepta los tres tipos de documento, de a uno por archivo', async () => {
    const { dto, errores } = await probar(['titulo', 'certificado', 'otro']);

    expect(errores).toHaveLength(0);
    expect(dto.tipos).toEqual(['titulo', 'certificado', 'otro']);
  });

  it('E10-H2 · con un solo archivo el campo llega como texto y se toma como una lista de uno', async () => {
    const { dto, errores } = await probar('titulo');

    expect(errores).toHaveLength(0);
    expect(dto.tipos).toEqual(['titulo']);
  });

  it('E10-H2 · rechaza el carnet, un tipo inventado, una lista vacía, más de 5 tipos o un valor que no es texto', async () => {
    for (const invalido of [
      ['carnet'],
      ['titulo', 'iniciacion_actividades'],
      [],
      ['titulo', 'titulo', 'titulo', 'titulo', 'titulo', 'titulo'],
      [1],
      undefined,
    ]) {
      const { errores } = await probar(invalido);

      expect(errores).toHaveLength(1);
      expect(Object.values(errores[0].constraints ?? {})).toEqual([
        MENSAJE_TIPOS,
      ]);
    }
  });
});
