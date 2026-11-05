import type { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';
import {
  FORMATO_HUELLA,
  HuellaCampana,
  VIGENCIA_VISTA_PREVIA_MS,
} from './huella-campana.js';

const configCon = (secreto: string) =>
  ({ get: () => secreto }) as unknown as ConfigService<Entorno, true>;

const CONTENIDO = {
  id: 4,
  asunto: 'Novedades',
  cuerpo: 'Llegó la línea reparadora.',
  segmento: '{"tipos":["cliente"],"categorias":[],"marcas":[]}',
};

const EMISION = new Date('2026-11-05T20:00:00.000Z');
const despues = (ms: number) => new Date(EMISION.getTime() + ms);

describe('HuellaCampana', () => {
  const huella = new HuellaCampana(configCon('s'.repeat(32)));

  it('E12-H3 · CA1 la confirmación de la vista previa sirve para la misma campaña', () => {
    const valor = huella.calcular(CONTENIDO, EMISION);

    expect(valor).toMatch(FORMATO_HUELLA);
    expect(huella.verificar(CONTENIDO, valor, despues(60_000))).toBe('valida');
  });

  it.each([
    ['otro asunto', { asunto: 'Otro' }],
    ['otro cuerpo', { cuerpo: 'Otro texto' }],
    ['otro segmento', { segmento: '{"tipos":["profesional"]}' }],
    ['otra campaña', { id: 5 }],
  ])(
    'E12-H3 · una campaña con %s después de la vista previa no se confirma con la huella anterior',
    (_caso, cambio) => {
      const valor = huella.calcular(CONTENIDO, EMISION);

      expect(
        huella.verificar({ ...CONTENIDO, ...cambio }, valor, EMISION),
      ).toBe('invalida');
    },
  );

  it('E12-H3 · la confirmación de la vista previa vence a la hora', () => {
    const valor = huella.calcular(CONTENIDO, EMISION);

    expect(
      huella.verificar(CONTENIDO, valor, despues(VIGENCIA_VISTA_PREVIA_MS)),
    ).toBe('valida');
    expect(
      huella.verificar(CONTENIDO, valor, despues(VIGENCIA_VISTA_PREVIA_MS + 1)),
    ).toBe('vencida');
  });

  it('E12-H3 · cambiar la fecha de emisión invalida la firma: no se puede alargar la vigencia', () => {
    const [, firma] = huella.calcular(CONTENIDO, EMISION).split('.');
    const reciente = String(
      Math.floor(despues(VIGENCIA_VISTA_PREVIA_MS * 2).getTime() / 1000),
    );

    expect(
      huella.verificar(
        CONTENIDO,
        `${reciente}.${firma}`,
        despues(VIGENCIA_VISTA_PREVIA_MS * 2),
      ),
    ).toBe('invalida');
  });

  it('E12-H3 · el asunto no se puede «correr» al cuerpo para repetir la huella', () => {
    const valor = huella.calcular(
      { ...CONTENIDO, asunto: 'ab', cuerpo: 'c' },
      EMISION,
    );

    expect(
      huella.verificar(
        { ...CONTENIDO, asunto: 'a', cuerpo: 'bc' },
        valor,
        EMISION,
      ),
    ).toBe('invalida');
  });

  it('E12-H3 · la huella depende del secreto y rechaza valores mal formados', () => {
    const otra = new HuellaCampana(configCon('t'.repeat(32)));

    expect(
      otra.verificar(CONTENIDO, huella.calcular(CONTENIDO, EMISION), EMISION),
    ).toBe('invalida');
    expect(huella.verificar(CONTENIDO, 'corta', EMISION)).toBe('invalida');
  });
});
